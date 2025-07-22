import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Scraper } from 'agent-twitter-client';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { promises as fs } from 'fs';
import { SearchMode } from 'agent-twitter-client';
import * as path from 'path';
import { setTimeout } from 'timers/promises';
import * as os from 'os';

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
  account?: { username: string },
): Promise<T> {
  let adjustedMs = ms;
  if (account?.username) {
    const health = TwitterClientProvider.prototype.getAccountHealth(
      account.username,
    );
    if (health) {
      const successRateFactor = Math.max(
        1,
        2 - (health.successRate || 0.5) * 1.5,
      );
      adjustedMs = Math.round(ms * successRateFactor);
    }
  }

  const timeout = new Promise<T>((_, reject) =>
    setTimeout(adjustedMs).then(() =>
      reject(
        new Error(
          `${operation} timed out after ${adjustedMs}ms (base: ${ms}ms)`,
        ),
      ),
    ),
  );
  return Promise.race([promise, timeout]);
}

enum ErrorType {
  TIMEOUT = 'timeout',
  NETWORK = 'network',
  RATE_LIMIT = 'rate_limit',
  AUTH = 'authentication',
  NOT_FOUND = 'not_found',
  ACCOUNT_LOCKED = 'account_locked',
  ACCOUNT_SUSPENDED = 'account_suspended',
  UNKNOWN = 'unknown',
}

function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

  try {
    const errorObj = JSON.parse(message);
    if (errorObj.errors && Array.isArray(errorObj.errors)) {
      if (errorObj.errors.some((err) => err.code === 326)) {
        return ErrorType.ACCOUNT_LOCKED;
      }
    }
  } catch (e) {}

  // Check for 401 status code indicating account suspension
  if (
    message.includes('response status: 401') ||
    message.includes('status code: 401')
  ) {
    return ErrorType.ACCOUNT_SUSPENDED;
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return ErrorType.TIMEOUT;
  }
  if (
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('connection') ||
    message.includes('socket')
  ) {
    return ErrorType.NETWORK;
  }
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429')
  ) {
    return ErrorType.RATE_LIMIT;
  }
  if (
    message.includes('auth') ||
    message.includes('login') ||
    message.includes('credentials') ||
    message.includes('unauthorized') ||
    message.includes('401')
  ) {
    return ErrorType.AUTH;
  }
  if (message.includes('not found') || message.includes('404')) {
    return ErrorType.NOT_FOUND;
  }
  if (
    message.includes('account is temporarily locked') ||
    message.includes('account locked') ||
    message.includes('to unlock your account')
  ) {
    return ErrorType.ACCOUNT_LOCKED;
  }
  return ErrorType.UNKNOWN;
}

enum AccountStatus {
  HEALTHY = 'healthy',
  PROBATION = 'probation',
  COOLDOWN = 'cooldown',
  DISABLED = 'disabled',
  LOCKED = 'locked',
  SUSPENDED = 'suspended',
}

interface AccountHealth {
  status: AccountStatus;
  lastUsed: number;
  requestCount: number;
  errorCounts: Record<ErrorType, number>;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  cooldownUntil?: number;
  lastErrorType?: ErrorType;
  lastErrorMessage?: string;
  lastErrorTime?: number;
  errorHistory: Array<{
    type: ErrorType;
    timestamp: number;
    message: string;
  }>;
  responseTimeHistory: number[];
  successRate: number;
  lastSuccessTime?: number;
  requestHistory: number[];
}

enum CircuitState {
  CLOSED = 0,
  OPEN = 1,
  HALF_OPEN = 2,
}

enum RequestPriority {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2,
}

interface Proxy {
  host: string;
  port: string;
  username: string;
  password: string;
  id: string;
  nextRequestAt: number;
}

@Injectable()
export class TwitterClientProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TwitterClientProvider.name);
  private scraper: Scraper;
  private credentials: any[] = [];
  private readonly dataFile: string;
  private readonly proxiesFile: string;
  private proxies: Proxy[] = [];
  private proxyAssignment: Map<string, Proxy> = new Map(); // Maps username to assigned proxy
  private proxyAgent: ProxyAgent | null = null;
  private proxyConfigured = false;

  private accountHealth = new Map<string, AccountHealth>();
  private concurrentOperations = 0;
  private readonly MAX_CONCURRENT_OPERATIONS: number;

  private credentialsLoaded = false;
  private loadingCredentials = false;

  private readonly MAX_CONSECUTIVE_FAILURES = 50;
  private readonly COOLDOWN_DURATION_MS = 2 * 60 * 1000;
  private readonly ERROR_RESET_TIME_MS = 15 * 60 * 1000;
  private readonly AUTO_RECOVERY_CHECK_INTERVAL_MS = 2 * 60 * 1000;
  private readonly ERROR_HISTORY_LIMIT = 25;

  private readonly AUTH_ERROR_THRESHOLD = 50;
  private readonly AUTH_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

  private readonly RESPONSE_TIME_HISTORY_LIMIT = 50;
  private readonly SUCCESS_RATE_WINDOW = 100;

  private circuitState = CircuitState.CLOSED;
  private circuitFailureCount = 0;
  private readonly CIRCUIT_FAILURE_THRESHOLD = 15;
  private circuitOpenTime = 0;
  private readonly CIRCUIT_RESET_TIMEOUT_MS = 60 * 1000;

  private healthCheckInterval: NodeJS.Timeout;
  private statsReportingInterval: NodeJS.Timeout;

  // Increased global request rate to meet 50 requests per 15 minutes requirement
  private globalRequestRate = 50;
  private lastRateAdjustment = 0;
  private readonly RATE_ADJUSTMENT_INTERVAL_MS = 60 * 1000;
  private readonly MIN_REQUEST_RATE = 1;
  private readonly MAX_REQUEST_RATE = 100; // Increased max rate

  // Updated to 50 requests per 15 minutes (900000ms)
  private readonly REQUESTS_PER_HOUR = 200; // 50 per 15 min = 200 per hour
  private readonly RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
  private readonly MAX_ACCOUNTS_PER_PROXY = 1000;

  private readonly CONNECTION_TIMEOUT_MS = 60000;
  private readonly OPERATION_TIMEOUTS = {
    login: 45000,
    search: 60000,
    profile: 30000,
    tweet: 35000,
    default: 30000,
  };

  constructor(private configService: ConfigService) {
    this.dataFile = path.resolve(__dirname, '../../../', 'data.json');
    this.proxiesFile = path.resolve(__dirname, '../../../', 'proxies.txt');
    const cpuCount = os.cpus().length;
    // Increased max concurrent operations for better parallelism
    this.MAX_CONCURRENT_OPERATIONS = Math.max(50, Math.min(50, cpuCount * 4));
    this.logger.log(
      `Setting max concurrent operations to ${this.MAX_CONCURRENT_OPERATIONS} based on ${cpuCount} CPU cores`,
    );
  }

  async onModuleInit() {
    await this.loadProxies();
    await this.loadCredentials();
    await this.initClient();

    this.healthCheckInterval = setInterval(
      () => this.checkAccountHealth(),
      this.AUTO_RECOVERY_CHECK_INTERVAL_MS,
    );
    this.statsReportingInterval = setInterval(
      () => this.reportStats(),
      5 * 60 * 1000,
    );
  }

  async onModuleDestroy() {
    clearInterval(this.healthCheckInterval);
    clearInterval(this.statsReportingInterval);
    await this.saveCredentials();
    this.logger.log('TwitterClientProvider resources cleaned up');
  }

  private async loadProxies() {
    try {
      const data = await fs.readFile(this.proxiesFile, 'utf8');
      const proxyLines = data
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.trim());

      this.proxies = proxyLines.map((line, index) => {
        const [host, port, username, password] = line.split(':');
        return {
          id: `proxy-${index}`,
          host,
          port,
          username,
          password,
          nextRequestAt: 0,
        };
      });

      this.logger.log(
        `Loaded ${this.proxies.length} proxies from ${this.proxiesFile}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load proxies from ${this.proxiesFile}: ${error.message}`,
      );
      this.proxies = [];
    }
  }

  private assignProxyToAccount(username: string): Proxy | null {
    if (this.proxyAssignment.has(username)) {
      return this.proxyAssignment.get(username);
    }

    if (this.proxies.length === 0) {
      this.logger.warn('No proxies available for assignment');
      return null;
    }

    // Simple round-robin assignment based on the number of assigned accounts
    const assignedCount = this.proxyAssignment.size;
    const proxyIndex = assignedCount % this.proxies.length;
    const assignedProxy = this.proxies[proxyIndex];

    this.proxyAssignment.set(username, assignedProxy);
    this.logger.log(
      `Assigned proxy ${assignedProxy.host}:${assignedProxy.port} to account ${username}`,
    );

    return assignedProxy;
  }

  private getProxyForAccount(username: string): Proxy | null {
    const assignedProxy = this.assignProxyToAccount(username);
    if (!assignedProxy) {
      return null;
    }

    const now = Date.now();

    // Check if proxy is ready for next request (simple rate limiting)
    if (now < assignedProxy.nextRequestAt) {
      const waitTime = assignedProxy.nextRequestAt - now;
      this.logger.debug(
        `Proxy ${assignedProxy.host}:${assignedProxy.port} for ${username} needs to wait ${waitTime}ms`,
      );
      return null;
    }

    // Update next request time (1 second between requests per proxy)
    assignedProxy.nextRequestAt = now + 1000;

    this.logger.debug(
      `Using proxy for ${username}: ${assignedProxy.host}:${assignedProxy.port}`,
    );

    return assignedProxy;
  }

  private configureProxy(username: string) {
    const proxy = this.getProxyForAccount(username);

    if (!proxy) {
      this.logger.warn(`No available proxy for account ${username}`);
      this.proxyConfigured = false;
      this.proxyAgent = null;
      return;
    }

    try {
      const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;

      const agentOptions = {
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: false },
        pipelining: 1,
        connect: {
          timeout: this.CONNECTION_TIMEOUT_MS,
        },
      } as any;

      this.proxyAgent = new ProxyAgent(agentOptions);
      setGlobalDispatcher(this.proxyAgent);
      this.proxyConfigured = true;

      this.logger.debug(
        `Configured proxy for ${username}: ${proxy.host}:${proxy.port}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to configure proxy for ${username}: ${error.message}`,
      );
      this.proxyConfigured = false;
      this.proxyAgent = null;
    }
  }

  private maskProxyUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.username) parsedUrl.username = '****';
      if (parsedUrl.password) parsedUrl.password = '****';
      return parsedUrl.toString();
    } catch {
      return 'invalid-url';
    }
  }

  setProxy(proxyUrl: string) {
    this.logger.warn(
      'setProxy is deprecated; proxies are managed via API keys',
    );
  }

  private async acquireSemaphore(timeoutMs = 10000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (this.concurrentOperations < this.MAX_CONCURRENT_OPERATIONS) {
        this.concurrentOperations++;
        return true;
      }
      // Reduced wait time for faster retry
      const attempt = Math.floor((Date.now() - startTime) / 1000) + 1;
      const baseWaitTime = Math.min(
        50 * Math.pow(1.5, Math.min(5, attempt)),
        2000,
      );
      const jitter = Math.random() * 0.2 * baseWaitTime;
      const waitTime = Math.round(baseWaitTime + jitter);
      this.logger.debug(
        `Semaphore acquisition attempt ${attempt}: waiting ${waitTime}ms`,
      );
      await setTimeout(waitTime);
    }
    return false;
  }

  private releaseSemaphore() {
    if (this.concurrentOperations > 0) {
      this.concurrentOperations--;
    }
  }

  private checkCircuitBreaker(): boolean {
    const now = Date.now();
    switch (this.circuitState) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        if (now - this.circuitOpenTime > this.CIRCUIT_RESET_TIMEOUT_MS) {
          this.circuitState = CircuitState.HALF_OPEN;
          this.logger.log('Circuit breaker moved from OPEN to HALF_OPEN state');
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        return true;
    }
  }

  private adjustRequestRate() {
    const now = Date.now();
    if (now - this.lastRateAdjustment < this.RATE_ADJUSTMENT_INTERVAL_MS) {
      return;
    }
    this.lastRateAdjustment = now;
    let totalSuccessRate = 0;
    let accountCount = 0;
    this.accountHealth.forEach((health) => {
      if (health.requestCount > 0) {
        totalSuccessRate += health.successRate;
        accountCount++;
      }
    });
    const avgSuccessRate =
      accountCount > 0 ? totalSuccessRate / accountCount : 0.5;
    if (avgSuccessRate > 0.9) {
      this.globalRequestRate = Math.min(
        this.MAX_REQUEST_RATE,
        this.globalRequestRate * 1.1,
      );
    } else if (avgSuccessRate < 0.7) {
      this.globalRequestRate = Math.max(
        this.MIN_REQUEST_RATE,
        this.globalRequestRate * 0.5,
      );
    }
    this.logger.log(
      `Adjusted global request rate to ${this.globalRequestRate.toFixed(2)} req/s (success rate: ${(avgSuccessRate * 100).toFixed(2)}%)`,
    );
  }

  private reportStats() {
    const stats = {
      accounts: {
        total: this.credentials.length,
        usable: this.credentials.filter((c) => c.usable).length,
        lockedInCredentials: this.credentials.filter((c) => c.isLocked).length,
        healthy: 0,
        probation: 0,
        cooldown: 0,
        disabled: 0,
        locked: 0,
        suspended: 0,
      },
      operations: {
        concurrent: this.concurrentOperations,
        requestRate: this.globalRequestRate,
      },
      circuitBreaker: {
        state: CircuitState[this.circuitState],
        failureCount: this.circuitFailureCount,
      },
      proxies: {
        total: this.proxies.length,
        assigned: this.proxyAssignment.size,
      },
      rateLimitStatus: {} as Record<
        string,
        { requestsInLastHour: number; maxRequests: number }
      >,
      resourceUsage: {
        heapUsed:
          (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal:
          (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      },
      proxyAssignment: {} as Record<string, string>,
    };
    this.accountHealth.forEach((health, username) => {
      stats.accounts[health.status]++;
      stats.rateLimitStatus[username] = {
        requestsInLastHour: health.requestHistory.length,
        maxRequests: this.REQUESTS_PER_HOUR,
      };
      const assignedProxy = this.proxyAssignment.get(username);
      stats.proxyAssignment[username] = assignedProxy
        ? `${assignedProxy.host}:${assignedProxy.port}`
        : 'none';
    });
    this.logger.log(`Stats: ${JSON.stringify(stats)}`);
  }

  private async checkAccountHealth() {
    try {
      await this.loadCredentials();
      const now = Date.now();
      let recoveredAccounts = 0;
      let reactivatedAccounts = 0;

      for (const cred of this.credentials) {
        const health = this.getAccountHealth(cred.username);

        health.requestHistory = health.requestHistory.filter(
          (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW_MS,
        );

        if (health.status === AccountStatus.HEALTHY) continue;
        if (health.status === AccountStatus.LOCKED || cred.isLocked) continue;
        if (health.status === AccountStatus.SUSPENDED) continue; // Don't try to recover suspended accounts

        if (
          health.status === AccountStatus.COOLDOWN &&
          health.cooldownUntil &&
          now > health.cooldownUntil
        ) {
          health.status = AccountStatus.PROBATION;
          health.consecutiveFailures = 0;
          this.logger.log(
            `Account ${cred.username} moved from cooldown to probation`,
          );
        }

        if (
          health.lastErrorTime &&
          now - health.lastErrorTime > this.ERROR_RESET_TIME_MS
        ) {
          Object.keys(health.errorCounts).forEach((key) => {
            health.errorCounts[key as ErrorType] = 0;
          });
          health.consecutiveFailures = 0;
          this.logger.log(
            `Reset error counts for account ${cred.username} due to time elapsed`,
          );
        }

        if (!cred.usable && !cred.isLocked) {
          cred.usable = true;
          reactivatedAccounts++;
          this.logger.log(
            `Reactivated account ${cred.username} that was previously marked as unusable`,
          );
          await this.saveCredentials();
        }

        if (
          (health.status === AccountStatus.PROBATION ||
            health.status === AccountStatus.COOLDOWN) &&
          now - health.lastUsed > this.COOLDOWN_DURATION_MS
        ) {
          try {
            this.logger.log(`Attempting recovery for account ${cred.username}`);
            const success = await this.tryLogin(cred);
            if (success) {
              health.status = AccountStatus.PROBATION;
              health.consecutiveSuccesses = 1;
              health.consecutiveFailures = 0;
              recoveredAccounts++;
              this.logger.log(
                `Successfully recovered account ${cred.username}`,
              );
            } else {
              this.logger.warn(
                `Failed to recover account ${cred.username}, but keeping it usable`,
              );
            }
          } catch (error) {
            this.logger.error(
              `Error during recovery attempt for ${cred.username}: ${error.message}`,
            );
          }
        }
      }

      if (recoveredAccounts > 0 || reactivatedAccounts > 0) {
        this.logger.log(
          `Health check results: Recovered ${recoveredAccounts} accounts, Reactivated ${reactivatedAccounts} accounts`,
        );
      }

      this.adjustRequestRate();
    } catch (error) {
      this.logger.error(`Error during account health check: ${error.message}`);
    }
  }

  public getAccountHealth(username: string): AccountHealth {
    if (!this.accountHealth.has(username)) {
      this.accountHealth.set(username, {
        status: AccountStatus.HEALTHY,
        lastUsed: 0,
        requestCount: 0,
        errorCounts: {
          [ErrorType.TIMEOUT]: 0,
          [ErrorType.NETWORK]: 0,
          [ErrorType.RATE_LIMIT]: 0,
          [ErrorType.AUTH]: 0,
          [ErrorType.NOT_FOUND]: 0,
          [ErrorType.ACCOUNT_LOCKED]: 0,
          [ErrorType.ACCOUNT_SUSPENDED]: 0,
          [ErrorType.UNKNOWN]: 0,
        },
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        errorHistory: [],
        responseTimeHistory: [],
        successRate: 1.0,
        requestHistory: [],
      });
    }
    return this.accountHealth.get(username);
  }

  private countRecentAuthErrors(username: string, windowMs: number): number {
    const health = this.getAccountHealth(username);
    const now = Date.now();
    return health.errorHistory.filter(
      (error) =>
        error.type === ErrorType.AUTH && now - error.timestamp < windowMs,
    ).length;
  }

  private canAccountMakeRequest(username: string): {
    canRequest: boolean;
    waitTime?: number;
  } {
    const health = this.getAccountHealth(username);
    const now = Date.now();

    health.requestHistory = health.requestHistory.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW_MS,
    );

    if (health.requestHistory.length < this.REQUESTS_PER_HOUR) {
      return { canRequest: true };
    }

    const oldestRequest = health.requestHistory[0];
    const waitTime = this.RATE_LIMIT_WINDOW_MS - (now - oldestRequest);

    this.logger.warn(
      `Account ${username} has reached rate limit of ${this.REQUESTS_PER_HOUR} requests/hour. Must wait ${Math.ceil(waitTime / 1000)} seconds.`,
    );

    return { canRequest: false, waitTime };
  }

  private updateAccountHealth(
    username: string,
    success: boolean,
    error?: Error,
    responseTimeMs?: number,
  ) {
    const health = this.getAccountHealth(username);
    const now = Date.now();

    health.lastUsed = now;
    health.requestCount++;
    health.requestHistory.push(now);
    health.requestHistory = health.requestHistory.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW_MS,
    );

    if (responseTimeMs !== undefined) {
      health.responseTimeHistory.push(responseTimeMs);
      if (
        health.responseTimeHistory.length > this.RESPONSE_TIME_HISTORY_LIMIT
      ) {
        health.responseTimeHistory.shift();
      }
    }

    const successCount = health.errorHistory.filter(
      (e) => now - e.timestamp < this.SUCCESS_RATE_WINDOW,
    ).length;
    health.successRate =
      health.requestCount > 0
        ? (health.requestCount - successCount) / health.requestCount
        : 1.0;

    if (success) {
      health.consecutiveSuccesses++;
      health.consecutiveFailures = 0;
      health.lastSuccessTime = now;

      if (
        health.status === AccountStatus.PROBATION &&
        health.consecutiveSuccesses >= 3
      ) {
        health.status = AccountStatus.HEALTHY;
        this.logger.log(
          `Account ${username} promoted from probation to healthy after ${health.consecutiveSuccesses} consecutive successes`,
        );
      }
    } else if (error) {
      const errorType = classifyError(error);

      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;
      health.errorCounts[errorType]++;
      health.lastErrorType = errorType;
      health.lastErrorMessage = error.message;
      health.lastErrorTime = now;

      health.errorHistory.push({
        type: errorType,
        timestamp: now,
        message: error.message,
      });

      if (health.errorHistory.length > this.ERROR_HISTORY_LIMIT) {
        health.errorHistory.shift();
      }

      switch (errorType) {
        case ErrorType.TIMEOUT:
        case ErrorType.ACCOUNT_LOCKED:
        case ErrorType.ACCOUNT_SUSPENDED:
          health.status =
            errorType === ErrorType.ACCOUNT_SUSPENDED
              ? AccountStatus.SUSPENDED
              : AccountStatus.LOCKED;
          this.logger.warn(
            `Account ${username} marked as ${health.status.toUpperCase()} due to ${errorType} error`,
          );
          const account = this.credentials.find((c) => c.username === username);
          if (account) {
            account.isLocked = true;
            account.usable = false;
            this.saveCredentials().catch((err) =>
              this.logger.error(
                `Failed to save ${health.status} status for ${username}: ${err.message}`,
              ),
            );
          }
          return false;

        case ErrorType.AUTH:
          if (health.consecutiveFailures >= 5) {
            health.status = AccountStatus.COOLDOWN;
            health.cooldownUntil = now + this.COOLDOWN_DURATION_MS;
            this.logger.warn(
              `Account ${username} put on cooldown due to authentication errors until ${new Date(health.cooldownUntil).toISOString()}`,
            );
          }
          break;

        case ErrorType.RATE_LIMIT:
          health.status = AccountStatus.COOLDOWN;
          health.cooldownUntil = now + this.COOLDOWN_DURATION_MS;
          this.logger.warn(
            `Account ${username} put on cooldown due to rate limiting until ${new Date(health.cooldownUntil).toISOString()}`,
          );
          break;

        case ErrorType.NETWORK:
          if (health.consecutiveFailures >= 10) {
            health.status = AccountStatus.PROBATION;
            this.logger.warn(
              `Account ${username} put on probation due to ${health.consecutiveFailures} consecutive network errors`,
            );
          }
          break;

        case ErrorType.NOT_FOUND:
          health.consecutiveFailures = Math.max(
            0,
            health.consecutiveFailures - 1,
          );
          break;

        case ErrorType.UNKNOWN:
        default:
          if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            health.status = AccountStatus.PROBATION;
            this.logger.warn(
              `Account ${username} put on probation due to ${health.consecutiveFailures} consecutive unknown errors`,
            );
          }
          break;
      }

      const recentAuthErrors = this.countRecentAuthErrors(
        username,
        this.AUTH_ERROR_WINDOW_MS,
      );
      if (recentAuthErrors >= this.AUTH_ERROR_THRESHOLD) {
        health.status = AccountStatus.DISABLED;
        this.logger.error(
          `Account ${username} disabled due to ${recentAuthErrors} authentication errors in the last 24 hours`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Selects an available account that is not rate-limited, locked, or disabled.
   * If none are available, returns an object with the account and the soonest wait time.
   */
  private async selectAvailableAccount(): Promise<
    any | { account: any; waitTime: number } | null
  > {
    await this.loadCredentials();
    const now = Date.now();
    // Filter for accounts that are not rate-limited, locked, or disabled
    const available = this.credentials.filter((acc) => {
      const health = this.getAccountHealth(acc.username);
      const { canRequest } = this.canAccountMakeRequest(acc.username);
      return (
        acc.usable &&
        !acc.isLocked &&
        canRequest &&
        health.status !== AccountStatus.DISABLED &&
        health.status !== AccountStatus.LOCKED &&
        !(
          health.status === AccountStatus.COOLDOWN &&
          health.cooldownUntil &&
          now < health.cooldownUntil
        )
      );
    });
    if (available.length > 0) {
      // Pick randomly for load balancing
      return available[Math.floor(Math.random() * available.length)];
    }
    // If none available, find the one with the soonest wait time
    let soonest = null;
    let minWait = Infinity;
    for (const acc of this.credentials) {
      const { canRequest, waitTime } = this.canAccountMakeRequest(acc.username);
      if (!canRequest && waitTime && waitTime < minWait) {
        minWait = waitTime;
        soonest = acc;
      }
    }
    if (soonest) return { account: soonest, waitTime: minWait };
    return null;
  }

  private updateCircuitBreaker(success: boolean) {
    switch (this.circuitState) {
      case CircuitState.CLOSED:
        if (!success) {
          this.circuitFailureCount++;
          if (this.circuitFailureCount >= this.CIRCUIT_FAILURE_THRESHOLD) {
            this.circuitState = CircuitState.OPEN;
            this.circuitOpenTime = Date.now();
            this.logger.warn(
              `Circuit breaker tripped to OPEN state after ${this.CIRCUIT_FAILURE_THRESHOLD} failures`,
            );
          }
        } else {
          this.circuitFailureCount = Math.max(0, this.circuitFailureCount - 1);
        }
        break;
      case CircuitState.HALF_OPEN:
        if (success) {
          this.circuitState = CircuitState.CLOSED;
          this.circuitFailureCount = 0;
          this.logger.log(
            'Circuit breaker reset to CLOSED state after successful operation',
          );
        } else {
          this.circuitState = CircuitState.OPEN;
          this.circuitOpenTime = Date.now();
          this.logger.warn(
            'Circuit breaker moved back to OPEN state after failure in HALF_OPEN state',
          );
        }
        break;
    }
  }

  /**
   * Executes an operation with the best available account, skipping rate-limited/locked/disabled accounts.
   * Only waits if all accounts are rate-limited. No queueing, runs immediately. Uses semaphore for concurrency control.
   */
  private async executeWithAccount<T>(
    operation: string,
    executor: (account: any) => Promise<T>,
    priority: RequestPriority = RequestPriority.MEDIUM,
  ): Promise<T | null> {
    if (!this.checkCircuitBreaker()) {
      this.logger.warn(`Circuit breaker is open, rejecting ${operation}`);
      return null;
    }
    const acquired = await this.acquireSemaphore();
    if (!acquired) {
      this.logger.warn(`Max concurrency reached, rejecting ${operation}`);
      return null;
    }
    try {
      let bannedAccounts = new Set<string>();
      let suspendedAccountsInThisRequest = new Set<string>();

      for (let attempt = 0; attempt < 10; attempt++) {
        // Increased attempts for more retries
        const selection = await this.selectAvailableAccount();
        let account: any;
        let waitTime: number | undefined;
        if (!selection) {
          this.logger.error(`No usable accounts available for ${operation}`);
          this.updateCircuitBreaker(false);
          return null;
        }
        if (selection.account && typeof selection.waitTime === 'number') {
          account = selection.account;
          waitTime = selection.waitTime;
        } else {
          account = selection;
        }
        // Skip banned accounts in this session
        if (
          bannedAccounts.has(account.username) ||
          suspendedAccountsInThisRequest.has(account.username)
        ) {
          continue;
        }
        if (typeof waitTime === 'number') {
          this.logger.log(
            `All accounts are rate-limited. Waiting ${Math.ceil(waitTime / 1000)} seconds for account ${account.username} to become available.`,
          );
          await setTimeout(waitTime + 100);
          attempt--;
          continue;
        }
        try {
          this.logger.log(
            `Attempting ${operation} with account: ${account.username} (attempt ${attempt + 1})`,
          );
          this.configureProxy(account.username);
          this.updateAccountHealth(account.username, false);
          const startTime = Date.now();
          const success = await this.tryLogin(account);
          if (!success) {
            this.logger.warn(
              `Login failed for ${account.username}, trying next account`,
            );
            this.updateAccountHealth(
              account.username,
              false,
              new Error('Login failed'),
            );

            continue;
          }
          const result = await executor(account);
          const responseTime = Date.now() - startTime;
          // If result is valid (not null/undefined/empty), return it
          if (
            result !== null &&
            result !== undefined &&
            !(Array.isArray(result) && result.length === 0)
          ) {
            this.updateAccountHealth(
              account.username,
              true,
              undefined,
              responseTime,
            );
            this.updateCircuitBreaker(true);

            return result;
          }
          // If result is empty, try next account
          this.logger.warn(
            `No data returned for ${operation} with account ${account.username}, trying next account.`,
          );
          this.updateAccountHealth(
            account.username,
            false,
            new Error('No data returned'),
          );
        } catch (error) {
          this.logger.error(
            `Error during ${operation} with account ${account.username}: ${error.message}`,
          );

          // --- ACCOUNT SUSPENSION/BAN DETECTION ---
          if (
            error &&
            typeof error.message === 'string' &&
            (error.message.includes('Response status: 401') ||
              error.message.includes('status code: 401') ||
              error.message.includes('Failed to perform request'))
          ) {
            this.logger.warn(
              `Account ${account.username} is suspended (${error.message.includes('401') ? '401' : 'Failed to perform request'}). Marking as unusable and retrying with next account.`,
            );
            account.isLocked = true;
            account.usable = false;
            await this.saveCredentials();
            const health = this.getAccountHealth(account.username);
            health.status = AccountStatus.SUSPENDED;
            suspendedAccountsInThisRequest.add(account.username);

            // DON'T increment attempt counter for suspended accounts - just try next account
            attempt--;
            continue;
          }

          // --- OTHER BAN DETECTION ---
          if (
            error &&
            typeof error.message === 'string' &&
            error.message.includes('User tweets fetch timed out')
          ) {
            this.logger.warn(
              `Account ${account.username} is likely banned (user tweets fetch timed out). Marking as locked and retrying with next account.`,
            );
            account.isLocked = true;
            account.usable = false;
            await this.saveCredentials();
            const health = this.getAccountHealth(account.username);
            health.status = AccountStatus.LOCKED;
            bannedAccounts.add(account.username);

            // DON'T increment attempt counter for banned accounts - just try next account
            attempt--;
            continue;
          }
          // --- END BAN DETECTION ---

          const errorType = classifyError(error);

          // Handle screen_name errors as temporary issues (retry with same account)
          if (
            error &&
            typeof error.message === 'string' &&
            error.message.includes(
              "Cannot read properties of undefined (reading 'screen_name')",
            )
          ) {
            this.logger.warn(
              `Temporary screen_name error for ${account.username}: ${error.message}. Will retry later.`,
            );
            this.updateAccountHealth(account.username, false, error);
            await setTimeout(2000); // Wait 2 seconds before retry
            continue; // Retry with same account
          }

          // Handle timeout errors - mark account as suspended immediately
          if (
            errorType === ErrorType.TIMEOUT ||
            errorType === ErrorType.NETWORK ||
            error.message.includes('timed out after')
          ) {
            this.logger.warn(
              `Account ${account.username} timed out on ${operation}. Marking as suspended and trying next account.`,
            );
            account.isLocked = true;
            account.usable = false;
            await this.saveCredentials();
            const health = this.getAccountHealth(account.username);
            health.status = AccountStatus.SUSPENDED;
            suspendedAccountsInThisRequest.add(account.username);
            // DON'T increment attempt counter for suspended accounts
            attempt--;
            continue;
          }
          const keepUsable = this.updateAccountHealth(
            account.username,
            false,
            error,
          );
          if (!keepUsable) {
            this.logger.error(
              `Account ${account.username} marked as unusable due to ${errorType} error`,
            );
          }
        }
      }
      this.logger.error(`All account attempts failed for ${operation}`);
      this.updateCircuitBreaker(false);
      return null;
    } catch (error) {
      this.logger.error(
        `Unexpected error in executeWithAccount: ${error.message}`,
      );
      this.updateCircuitBreaker(false);
      return null;
    } finally {
      this.releaseSemaphore();
    }
  }

  // Completely rewritten to execute operations in parallel
  private async batchExecuteWithAccount<T>(
    operations: string[],
    executors: ((account: any) => Promise<T>)[],
    priority: RequestPriority = RequestPriority.MEDIUM,
  ): Promise<(T | null)[]> {
    if (operations.length !== executors.length) {
      throw new Error(
        'Operations and executors arrays must have the same length',
      );
    }

    // For small batches, process in parallel with different accounts
    if (operations.length <= 5) {
      return Promise.all(
        operations.map((operation, index) =>
          this.executeWithAccount(operation, executors[index], priority),
        ),
      );
    }

    // For larger batches, try to use a single account
    const account = await this.selectAvailableAccount();
    if (!account) {
      this.logger.error(`No usable accounts available for batch operations`);
      return executors.map(() => null);
    }

    const { canRequest, waitTime } = this.canAccountMakeRequest(
      account.username,
    );
    if (!canRequest && waitTime) {
      this.logger.log(
        `Account ${account.username} rate-limited for batch operations. Waiting ${Math.ceil(waitTime / 1000)} seconds.`,
      );
      await setTimeout(waitTime + 100);
    }

    try {
      this.logger.log(
        `Attempting batch of ${operations.length} operations with account: ${account.username}`,
      );

      this.configureProxy(account.username);
      this.updateAccountHealth(account.username, false);

      const success = await this.tryLogin(account);
      if (!success) {
        this.logger.warn(`Login failed for ${account.username}`);
        this.updateAccountHealth(
          account.username,
          false,
          new Error('Login failed'),
        );
        return executors.map(() => null);
      }

      // Process in chunks of 10 operations at a time
      const chunkSize = 10;
      const results: (T | null)[] = new Array(operations.length).fill(null);

      for (let i = 0; i < operations.length; i += chunkSize) {
        const chunk = executors.slice(i, i + chunkSize);
        const chunkOperations = operations.slice(i, i + chunkSize);

        const chunkResults = await Promise.all(
          chunk.map(async (executor, index) => {
            try {
              const startTime = Date.now();
              const result = await executor(account);
              const responseTime = Date.now() - startTime;

              this.updateAccountHealth(
                account.username,
                true,
                undefined,
                responseTime,
              );
              return result;
            } catch (error) {
              this.logger.error(
                `Error during ${chunkOperations[index]} with account ${account.username}: ${error.message}`,
              );
              this.updateAccountHealth(account.username, false, error);
              return null;
            }
          }),
        );

        // Copy chunk results to the main results array
        for (let j = 0; j < chunkResults.length; j++) {
          results[i + j] = chunkResults[j];
        }
      }

      const successCount = results.filter((r) => r !== null).length;
      if (successCount >= Math.ceil(operations.length / 2)) {
        this.updateCircuitBreaker(true);
      } else {
        this.updateCircuitBreaker(false);
      }

      return results;
    } catch (error) {
      this.logger.error(
        `Unexpected error in batchExecuteWithAccount: ${error.message}`,
      );
      this.updateCircuitBreaker(false);
      return executors.map(() => null);
    }
  }

  getClient(): any {
    return {
      // Parallel search for multiple queries
      fetchMultipleSearches: async (
        queries: string[],
        mode = SearchMode.Latest,
      ) => {
        const operations = queries.map((q) => `tweet search for "${q}"`);
        const executors = queries.map((query) => async () => {
          this.logger.log(
            `Searching tweets with query: ${query}, mode: ${mode}`,
          );
          const startTime = Date.now();

          const response = await withTimeout(
            this.scraper.fetchSearchTweets(query, 20, mode),
            this.OPERATION_TIMEOUTS.search,
            'Tweet search',
          );

          this.logger.log(
            `Search query "${query}" took ${Date.now() - startTime}ms`,
          );

          if (!response || !response.tweets || response.tweets.length === 0) {
            this.logger.log(`No tweets found for query: ${query}`);
            return { tweets: [], next: null, previous: null };
          }

          const processedTweets = response.tweets.map((tweet: any) => {
            if (!tweet.username && tweet.permanentUrl) {
              const urlParts = tweet.permanentUrl.split('/');
              if (urlParts.length >= 4) {
                tweet.username = urlParts[3];
              }
            }

            if (!tweet.text && tweet.html) {
              tweet.text = tweet.html.replace(/<[^>]*>/g, '');
            }

            return tweet;
          });

          this.logger.log(
            `Found ${processedTweets.length} tweets for query: ${query}`,
          );

          return {
            query,
            tweets: processedTweets,
            next: response.next || null,
            previous: response.previous || null,
          };
        });

        return this.batchExecuteWithAccount(operations, executors);
      },

      fetchTweetsSearch: async (
        query: string,
        mode = SearchMode.Latest,
        cursor?: string,
      ) => {
        return this.executeWithAccount(
          `tweet search for "${query}"`,
          async () => {
            this.logger.log(
              `Searching tweets with query: ${query}, mode: ${mode}`,
            );
            const startTime = Date.now();

            const response = await withTimeout(
              this.scraper.fetchSearchTweets(query, 20, mode, cursor),
              this.OPERATION_TIMEOUTS.search,
              'Tweet search',
            );

            this.logger.log(
              `Search query "${query}" took ${Date.now() - startTime}ms`,
            );

            if (!response || !response.tweets || response.tweets.length === 0) {
              this.logger.log(`No tweets found for query: ${query}`);
              return { tweets: [], next: null, previous: null };
            }

            const processedTweets = response.tweets.map((tweet: any) => {
              if (!tweet.username && tweet.permanentUrl) {
                const urlParts = tweet.permanentUrl.split('/');
                if (urlParts.length >= 4) {
                  tweet.username = urlParts[3];
                }
              }

              if (!tweet.text && tweet.html) {
                tweet.text = tweet.html.replace(/<[^>]*>/g, '');
              }

              return tweet;
            });

            this.logger.log(`Found ${processedTweets.length} tweets`);

            return {
              tweets: processedTweets,
              next: response.next || null,
              previous: response.previous || null,
            };
          },
        );
      },

      // Get multiple profiles in parallel
      getProfiles: async (usernames: string[]) => {
        const operations = usernames.map(
          (username) => `profile fetch for ${username}`,
        );
        const executors = usernames.map((username) => async () => {
          this.logger.log(`Fetching profile for username: ${username}`);

          const profile = await withTimeout(
            this.scraper.getProfile(username),
            this.OPERATION_TIMEOUTS.profile,
            'Profile fetch',
          );

          return profile;
        });

        return this.batchExecuteWithAccount(operations, executors);
      },

      getProfile: async (username: string) => {
        return this.executeWithAccount(
          `profile fetch for ${username}`,
          async () => {
            this.logger.log(`Fetching profile for username: ${username}`);

            const profile = await withTimeout(
              this.scraper.getProfile(username),
              this.OPERATION_TIMEOUTS.profile,
              'Profile fetch',
            );

            return profile;
          },
        );
      },

      // Get tweets for multiple users in parallel
      getMultipleUsersTweets: async (usernames: string[], count: number) => {
        const operations = usernames.map(
          (username) => `tweets fetch for ${username}`,
        );
        const executors = usernames.map((username) => async () => {
          this.logger.log(`Fetching tweets for username: ${username}`);

          const response = await withTimeout(
            (async () => {
              const tweets = [];
              let collected = 0;

              for await (const tweet of this.scraper.getTweets(
                username,
                count,
              )) {
                tweets.push(tweet);
                collected++;
                if (collected >= count) break;
              }
              return tweets;
            })(),
            this.OPERATION_TIMEOUTS.tweet,
            'Tweets fetch',
          );

          if (!response) {
            this.logger.warn(
              `Empty response received from Twitter tweets for ${username}`,
            );
            return null;
          }

          const safeResponse = JSON.parse(
            JSON.stringify(response, (key, value) =>
              key === 'inReplyToStatus' ? undefined : value,
            ),
          );

          return { username, tweets: safeResponse };
        });

        return this.batchExecuteWithAccount(operations, executors);
      },

      getTweets: async (username: string, count: number) => {
        return this.executeWithAccount(
          `tweets fetch for ${username}`,
          async () => {
            this.logger.log(`Fetching tweets for username: ${username}`);

            const response = await withTimeout(
              (async () => {
                const tweets = [];
                let collected = 0;

                for await (const tweet of this.scraper.getTweets(
                  username,
                  count,
                )) {
                  tweets.push(tweet);
                  collected++;
                  if (collected >= count) break;
                }
                return tweets;
              })(),
              this.OPERATION_TIMEOUTS.tweet,
              'Tweets fetch',
            );

            if (!response) {
              this.logger.warn(`Empty response received from Twitter tweets`);
              return null;
            }

            const safeResponse = JSON.parse(
              JSON.stringify(response, (key, value) =>
                key === 'inReplyToStatus' ? undefined : value,
              ),
            );

            return safeResponse;
          },
        );
      },

      getTweetsAndReplies: async (username: string, count: number) => {
        return this.executeWithAccount(
          `tweets and replies fetch for ${username}`,
          async () => {
            this.logger.log(
              `Fetching tweets and replies for username: ${username}`,
            );

            const response = await withTimeout(
              (async () => {
                const tweets = [];
                let collected = 0;

                for await (const tweet of this.scraper.getTweetsAndReplies(
                  username,
                  count,
                )) {
                  tweets.push(tweet);
                  collected++;
                  if (collected >= count) break;
                }
                return tweets;
              })(),
              this.OPERATION_TIMEOUTS.tweet,
              'Tweets and replies fetch',
            );

            if (!response) {
              this.logger.warn(
                `Empty response received from Twitter tweets and replies`,
              );
              return null;
            }

            return response;
          },
        );
      },

      getLatestTweet: async (username: string) => {
        return this.executeWithAccount(
          `latest tweet fetch for ${username}`,
          async () => {
            this.logger.log(`Fetching latest tweet for username: ${username}`);

            const response = await withTimeout(
              this.scraper.getLatestTweet(username),
              this.OPERATION_TIMEOUTS.tweet,
              'Latest tweet fetch',
            );

            return response;
          },
        );
      },

      getProfileByUserId: async (userId: string) => {
        return this.executeWithAccount(
          `profile fetch by user ID ${userId}`,
          async () => {
            this.logger.log(`Fetching screen name for user ID: ${userId}`);

            const screenName = await withTimeout(
              this.scraper.getScreenNameByUserId(userId),
              this.OPERATION_TIMEOUTS.profile,
              'Screen name fetch',
            );

            if (!screenName) {
              this.logger.warn(
                `Empty response received from Twitter screen name fetch`,
              );
              return null;
            }

            const profile = await withTimeout(
              this.scraper.getProfile(screenName),
              this.OPERATION_TIMEOUTS.profile,
              'Profile fetch',
            );

            return profile;
          },
        );
      },
      // Search for profiles based on a query
      searchProfiles: async function* (query: string, maxProfiles?: number) {
        let yielded = 0;

        try {
          const acquired = await this.acquireSemaphore();
          if (!acquired) {
            this.logger.warn(
              `Too many concurrent operations, rejecting profile search`,
            );
            return;
          }

          try {
            for (let attempt = 0; attempt < 3; attempt++) {
              const account = await this.selectAvailableAccount();
              if (!account) {
                this.logger.error(
                  `No usable accounts available for profile search`,
                );
                return;
              }

              const { canRequest, waitTime } = this.canAccountMakeRequest(
                account.username,
              );
              if (!canRequest && waitTime) {
                this.logger.log(
                  `Account ${account.username} rate-limited for profile search. Waiting ${Math.ceil(waitTime / 1000)} seconds.`,
                );
                await setTimeout(waitTime + 100);
                attempt--;
                continue;
              }

              try {
                this.logger.log(
                  `Attempting profile search with account: ${account.username} (attempt ${attempt + 1})`,
                );
                this.configureProxy(account.username);
                this.updateAccountHealth(account.username, false);

                const success = await this.tryLogin(account);
                if (!success) {
                  this.logger.warn(
                    `Login failed for ${account.username}, trying next account`,
                  );
                  this.updateAccountHealth(
                    account.username,
                    false,
                    new Error('Login failed'),
                  );
                  continue;
                }

                this.logger.log(`Searching profiles with query: ${query}`);

                const timeoutMs = 60000;
                const startTime = Date.now();

                try {
                  for await (const profile of this.scraper.searchProfiles(
                    query,
                    maxProfiles,
                  )) {
                    yield profile;
                    yielded++;

                    if (maxProfiles && yielded >= maxProfiles) {
                      this.updateAccountHealth(account.username, true);
                      return;
                    }

                    if (Date.now() - startTime > timeoutMs) {
                      this.logger.warn(
                        `Profile search timed out after ${timeoutMs}ms`,
                      );
                      this.updateAccountHealth(
                        account.username,
                        false,
                        new Error('Search timed out'),
                      );
                      return;
                    }
                  }

                  this.updateAccountHealth(account.username, true);
                  return;
                } catch (error) {
                  this.logger.error(
                    `Error during profile search: ${error.message}`,
                  );
                  const keepUsable = this.updateAccountHealth(
                    account.username,
                    false,
                    error,
                  );

                  if (
                    classifyError(error) === ErrorType.NOT_FOUND ||
                    yielded > 0
                  ) {
                    return;
                  }
                }
              } catch (error) {
                this.logger.error(
                  `Error during profile search with account ${account.username}: ${error.message}`,
                );
                this.updateAccountHealth(account.username, false, error);
              }
            }

            this.logger.error(`All account attempts failed for profile search`);
          } finally {
            this.releaseSemaphore();
          }
        } catch (error) {
          this.logger.error(
            `Unexpected error in searchProfiles: ${error.message}`,
          );
        }
      },

      getUserTweetsByUsername: async (
        username: string,
        maxTweets?: number,
        cursor?: string,
      ) => {
        return this.executeWithAccount(
          `user tweets fetch by username ${username}`,
          async () => {
            this.logger.log(`Fetching tweets for username: ${username}`);

            const response = await withTimeout(
              this.scraper.getUserTweets(username, maxTweets, String(cursor)),
              this.OPERATION_TIMEOUTS.tweet,
              'User tweets fetch',
            );

            if (!response) {
              this.logger.warn(
                `Empty response received from Twitter user tweets fetch`,
              );
              return null;
            }

            return {
              tweets: response.tweets || [],
              next: response.next || null,
            };
          },
        );
      },

      // Fetch large number of tweets with automatic pagination
      getUserTweetsLarge: async (
        username: string,
        maxTweets: number = 1000,
        batchSize: number = 50,
      ) => {
        return this.executeWithAccount(
          `large user tweets fetch for ${username}`,
          async () => {
            this.logger.log(
              `Fetching up to ${maxTweets} tweets for username: ${username} in batches of ${batchSize}`,
            );

            const allTweets = [];
            let cursor: string | null = null;
            let fetchedCount = 0;
            let batchCount = 0;

            while (fetchedCount < maxTweets) {
              const remainingTweets = maxTweets - fetchedCount;
              const currentBatchSize = Math.min(batchSize, remainingTweets);

              batchCount++;
              this.logger.log(
                `Fetching batch ${batchCount} for ${username}: ${currentBatchSize} tweets (cursor: ${cursor || 'initial'})`,
              );

              try {
                const response = await withTimeout(
                  this.scraper.getUserTweets(
                    username,
                    currentBatchSize,
                    cursor,
                  ),
                  this.OPERATION_TIMEOUTS.tweet * 2, // Double timeout for large fetches
                  'Large user tweets fetch',
                );

                if (
                  !response ||
                  !response.tweets ||
                  response.tweets.length === 0
                ) {
                  this.logger.log(
                    `No more tweets available for ${username} after ${fetchedCount} tweets`,
                  );
                  break;
                }

                allTweets.push(...response.tweets);
                fetchedCount += response.tweets.length;
                cursor = response.next;

                this.logger.log(
                  `Batch ${batchCount} completed for ${username}: ${response.tweets.length} tweets fetched (total: ${fetchedCount})`,
                );

                // If no cursor, we've reached the end
                if (!cursor) {
                  this.logger.log(
                    `Reached end of tweets for ${username} (no more cursor)`,
                  );
                  break;
                }

                // Small delay between batches to avoid rate limits
                await setTimeout(500);
              } catch (error) {
                this.logger.error(
                  `Error in batch ${batchCount} for ${username}: ${error.message}`,
                );
                // Continue with what we have so far
                break;
              }
            }

            this.logger.log(
              `Large fetch completed for ${username}: ${allTweets.length} total tweets fetched in ${batchCount} batches`,
            );

            return {
              tweets: allTweets,
              totalFetched: allTweets.length,
              batchesCompleted: batchCount,
              lastCursor: cursor,
              requestedAmount: maxTweets,
            };
          },
        );
      },

      // Get tweets for multiple user IDs in parallel
      getMultipleUsersTweetsByIds: async (
        userIds: string[],
        maxTweets?: number,
      ) => {
        const operations = userIds.map(
          (userId) => `user tweets fetch by ID ${userId}`,
        );
        const executors = userIds.map((userId) => async () => {
          this.logger.log(`Fetching tweets for user ID: ${userId}`);

          const response = await withTimeout(
            this.scraper.getUserTweets(userId, maxTweets),
            this.OPERATION_TIMEOUTS.tweet,
            'User tweets fetch',
          );

          if (!response) {
            this.logger.warn(
              `Empty response received from Twitter user ID tweets fetch for ${userId}`,
            );
            return null;
          }

          return {
            userId,
            tweets: response.tweets || [],
            next: response.next || null,
          };
        });

        return this.batchExecuteWithAccount(operations, executors);
      },
      getUserTweetsByUserId: async (
        userId: string,
        maxTweets?: number,
        cursor?: string,
      ) => {
        return this.executeWithAccount(
          `user tweets fetch by ID ${userId}`,
          async () => {
            this.logger.log(`Fetching tweets for user ID: ${userId}`);

            const response = await withTimeout(
              this.scraper.getUserTweets(userId, maxTweets, String(cursor)),
              this.OPERATION_TIMEOUTS.tweet,
              'User tweets fetch',
            );

            if (!response) {
              this.logger.warn(
                `Empty response received from Twitter user ID tweets fetch`,
              );
              return null;
            }

            return {
              tweets: response.tweets || [],
              next: response.next || null,
            };
          },
        );
      },
      // Get multiple tweets in parallel
      getMultipleTweets: async (tweetIds: string[]) => {
        const operations = tweetIds.map(
          (tweetId) => `tweet fetch for ${tweetId}`,
        );
        const executors = tweetIds.map((tweetId) => async () => {
          this.logger.log(`Fetching tweet with ID: ${tweetId}`);

          const response = await withTimeout(
            this.scraper.getTweet(tweetId),
            this.OPERATION_TIMEOUTS.tweet,
            'Tweet fetch',
          );

          return {
            tweetId,
            tweet: response,
          };
        });

        return this.batchExecuteWithAccount(operations, executors);
      },

      getTweet: async (tweetId: string) => {
        return this.executeWithAccount(
          `tweet fetch for ${tweetId}`,
          async () => {
            this.logger.log(`Fetching tweet with ID: ${tweetId}`);

            const response = await withTimeout(
              this.scraper.getTweet(tweetId),
              this.OPERATION_TIMEOUTS.tweet,
              'Tweet fetch',
            );

            return response;
          },
        );
      },

      fetchProfileFollowers: async (
        userId: string,
        maxProfiles: number,
        cursor?: string,
      ) => {
        return this.executeWithAccount(
          `profile followers fetch for ${userId}`,
          async () => {
            this.logger.log(`Fetching followers for user ID: ${userId}`);

            const response = await withTimeout(
              this.scraper.fetchProfileFollowers(userId, maxProfiles, cursor),
              this.OPERATION_TIMEOUTS.profile,
              'Profile followers fetch',
            );

            if (!response) {
              this.logger.warn(
                `Empty response received from Twitter followers fetch`,
              );
              return null;
            }

            return {
              profiles: response.profiles || [],
              next: response.next || null,
            };
          },
        );
      },

      fetchProfileFollowing: async (
        userId: string,
        maxProfiles: number,
        cursor?: string,
      ) => {
        return this.executeWithAccount(
          `profile following fetch for ${userId}`,
          async () => {
            this.logger.log(`Fetching following for user ID: ${userId}`);
            const response = await withTimeout(
              this.scraper.fetchProfileFollowing(userId, 20, cursor),
              this.OPERATION_TIMEOUTS.profile,
              'Profile following fetch',
            );

            if (!response) {
              this.logger.warn(
                `Empty response received from Twitter following fetch`,
              );
              return null;
            }

            return {
              profiles: response.profiles || [],
              next: response.next || null,
            };
          },
        );
      },

      getTweetReplies: async (tweetId: string, cursor?: string) => {
        return this.executeWithAccount(
          `tweet replies fetch for ${tweetId}`,
          async () => {
            this.logger.log(`Fetching replies for tweet ID: ${tweetId}`);

            const response = await withTimeout(
              this.scraper.fetchSearchTweets(
                `conversation_id:${tweetId}`,
                20,
                SearchMode.Latest,
                cursor,
              ),
              this.OPERATION_TIMEOUTS.search,
              'Tweet replies fetch',
            );

            return response;
          },
        );
      },

      getTweetQuotes: async (tweetId: string, cursor?: string) => {
        return this.executeWithAccount(
          `tweet quotes fetch for ${tweetId}`,
          async () => {
            this.logger.log(`Fetching quotes for tweet ID: ${tweetId}`);

            const response = await withTimeout(
              this.scraper.fetchSearchTweets(
                `url:${tweetId} include:nativeretweets -RT`,
                20,
                SearchMode.Latest,
                cursor,
              ),
              this.OPERATION_TIMEOUTS.search,
              'Tweet quotes fetch',
            );

            return response;
          },
        );
      },

      // Fetch user timeline with date range filtering
      getUserTimelineInDateRange: async (
        username: string,
        startDate: Date,
        endDate: Date,
        maxTweets: number = 500,
        batchSize: number = 50,
      ) => {
        return this.executeWithAccount(
          `timeline fetch for ${username} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
          async () => {
            this.logger.log(
              `Fetching timeline for ${username} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
            );

            const allTweets = [];
            let fetchedCount = 0;
            let batchCount = 0;
            let foundOlderThanRange = false;

            try {
              // Use the timeline iterator
              for await (const tweet of this.scraper.getTweets(
                username,
                maxTweets,
              )) {
                batchCount++;

                // Parse tweet date
                const tweetDate = new Date(tweet.timeParsed || tweet.timestamp);

                // If tweet is older than our end date, we've gone too far back
                if (tweetDate < endDate) {
                  this.logger.log(
                    `Reached tweets older than end date (${endDate.toISOString()}) at tweet from ${tweetDate.toISOString()}`,
                  );
                  foundOlderThanRange = true;
                  break;
                }

                // If tweet is within our date range, include it
                if (tweetDate >= endDate && tweetDate <= startDate) {
                  allTweets.push({
                    ...tweet,
                    parsedDate: tweetDate.toISOString(),
                  });
                  fetchedCount++;

                  if (fetchedCount % 50 === 0) {
                    this.logger.log(
                      `Found ${fetchedCount} tweets in date range for ${username}`,
                    );
                  }
                }

                // Stop if we've found enough tweets in range
                if (fetchedCount >= maxTweets) {
                  this.logger.log(
                    `Reached maximum tweets limit (${maxTweets}) for ${username}`,
                  );
                  break;
                }

                // Add small delay every batch to avoid rate limits
                if (batchCount % batchSize === 0) {
                  await setTimeout(200);
                }
              }
            } catch (error) {
              this.logger.error(
                `Error fetching timeline for ${username}: ${error.message}`,
              );
              // Return what we have so far
            }

            // Sort tweets by date (newest first)
            allTweets.sort(
              (a, b) =>
                new Date(b.parsedDate).getTime() -
                new Date(a.parsedDate).getTime(),
            );

            this.logger.log(
              `Timeline fetch completed for ${username}: ${allTweets.length} tweets found in date range (${startDate.toISOString()} to ${endDate.toISOString()})`,
            );

            return {
              tweets: allTweets,
              totalInRange: allTweets.length,
              totalProcessed: batchCount,
              dateRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
              },
              reachedEndOfRange: foundOlderThanRange,
            };
          },
        );
      },

      // Fetch user timeline with date range (alternative method using search)
      getUserTimelineBySearch: async (
        username: string,
        startDate: Date,
        endDate: Date,
        maxTweets: number = 200,
      ) => {
        return this.executeWithAccount(
          `search timeline for ${username} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
          async () => {
            // Format dates for Twitter search (YYYY-MM-DD)
            const startDateStr = startDate.toISOString().split('T')[0];
            const endDateStr = endDate.toISOString().split('T')[0];

            // Build search query with date range
            const query = `from:${username} since:${endDateStr} until:${startDateStr}`;

            this.logger.log(`Searching tweets with query: ${query}`);

            const response = await withTimeout(
              this.scraper.fetchSearchTweets(
                query,
                maxTweets,
                SearchMode.Latest,
              ),
              this.OPERATION_TIMEOUTS.search * 2,
              'Timeline search',
            );

            if (!response || !response.tweets || response.tweets.length === 0) {
              this.logger.log(`No tweets found for query: ${query}`);
              return {
                tweets: [],
                totalFound: 0,
                query: query,
                dateRange: {
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                },
              };
            }

            // Add parsed dates to tweets
            const tweetsWithDates = response.tweets.map((tweet) => ({
              ...tweet,
              parsedDate: new Date(
                tweet.timeParsed || tweet.timestamp,
              ).toISOString(),
            }));

            this.logger.log(
              `Found ${tweetsWithDates.length} tweets for ${username} in date range`,
            );

            return {
              tweets: tweetsWithDates,
              totalFound: tweetsWithDates.length,
              query: query,
              dateRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
              },
              next: response.next || null,
            };
          },
        );
      },
    };
  }

  private async loadCredentials() {
    if (this.loadingCredentials) {
      return;
    }

    if (this.credentialsLoaded && this.credentials.length > 0) {
      return;
    }

    this.loadingCredentials = true;

    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      this.credentials = JSON.parse(data);
      this.credentialsLoaded = true;

      this.logger.log(
        `Loaded ${this.credentials.length} accounts from ${this.dataFile}`,
      );

      this.credentials.forEach((cred) => {
        if (!this.accountHealth.has(cred.username)) {
          this.accountHealth.set(cred.username, {
            status: AccountStatus.HEALTHY,
            lastUsed: 0,
            requestCount: 0,
            errorCounts: {
              [ErrorType.TIMEOUT]: 0,
              [ErrorType.NETWORK]: 0,
              [ErrorType.RATE_LIMIT]: 0,
              [ErrorType.AUTH]: 0,
              [ErrorType.NOT_FOUND]: 0,
              [ErrorType.ACCOUNT_LOCKED]: 0,
              [ErrorType.ACCOUNT_SUSPENDED]: 0,
              [ErrorType.UNKNOWN]: 0,
            },
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            errorHistory: [],
            responseTimeHistory: [],
            successRate: 1.0,
            requestHistory: [],
          });
        }

        if (cred.isLocked) {
          const health = this.accountHealth.get(cred.username);
          if (health) {
            health.status = AccountStatus.LOCKED;
          }
        } else {
          cred.usable = true;
        }
      });

      // Proxies are assigned on-demand to accounts
    } catch (error) {
      this.logger.error(
        `Failed to load credentials from ${this.dataFile}: ${error.message}`,
      );
      this.credentials = [];
    } finally {
      this.loadingCredentials = false;
    }
  }

  private async saveCredentials() {
    try {
      await fs.writeFile(
        this.dataFile,
        JSON.stringify(this.credentials, null, 2),
      );
      this.logger.log(
        `Saved ${this.credentials.length} accounts to ${this.dataFile}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save credentials to ${this.dataFile}: ${error.message}`,
      );
    }
  }

  private async tryLogin(cred: {
    username: string;
    password: string;
    email?: string;
    '2fa'?: string;
    cookie?: any[];
    usable?: boolean;
    isLocked?: boolean;
  }) {
    if (cred.isLocked) {
      this.logger.warn(`Skipping login for locked account ${cred.username}`);
      return false;
    }

    if (cred.cookie && Array.isArray(cred.cookie) && cred.cookie.length > 0) {
      try {
        this.logger.log(`Setting cookies for ${cred.username} (no validation)`);
        const cookieStrings = cred.cookie.map(
          (cookie) =>
            `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path};${cookie.secure ? ' Secure;' : ''}${cookie.httpOnly ? ' HttpOnly;' : ''} SameSite=${cookie.sameSite || 'Lax'}`,
        );
        await this.scraper.setCookies(cookieStrings);
        return true;
      } catch (err) {
        this.logger.warn(
          `Failed to set cookies for ${cred.username}: ${err.message}`,
        );
      }
    }

    try {
      this.logger.log(
        `Attempting to login with credentials for ${cred.username}`,
      );

      await setTimeout(1000);

      try {
        await withTimeout(
          this.scraper.login(
            cred.username,
            cred.password,
            cred.email,
            cred['2fa'],
          ),
          this.OPERATION_TIMEOUTS.login,
          'Login',
        );

        this.logger.log(`Login successful for ${cred.username}`);

        const newCookies = await this.scraper.getCookies();
        const cookiesToStore = newCookies
          .filter((cookie) =>
            ['auth_token', 'ct0', 'guest_id'].includes(cookie.key),
          )
          .map((cookie) => ({
            key: cookie.key,
            value: cookie.value,
            expires:
              cookie.expires instanceof Date
                ? cookie.expires.toISOString()
                : cookie.expires || null,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'Lax',
          }));

        if (cookiesToStore.length > 0) {
          cred.cookie = cookiesToStore;
          this.logger.log(
            `Cookies updated for ${cred.username}: ${cookiesToStore.length} cookies stored`,
          );
        } else {
          this.logger.warn(`No cookies obtained for ${cred.username}`);
        }

        cred.usable = true;
        cred.isLocked = false;
        await this.saveCredentials();
        return true;
      } catch (error) {
        console.log(error);
        this.logger.error(
          `Login failed for ${cred.username}: ${error.message}`,
        );

        try {
          const errorObj = JSON.parse(error.message);
          if (errorObj.errors && Array.isArray(errorObj.errors)) {
            const lockedError = errorObj.errors.find((err) => err.code === 326);
            if (lockedError) {
              this.logger.warn(
                `Account ${cred.username} is locked: ${lockedError.message}`,
              );
              cred.isLocked = true;
              cred.usable = false;
              await this.saveCredentials();

              const health = this.getAccountHealth(cred.username);
              health.status = AccountStatus.LOCKED;

              return false;
            }
          }
        } catch (e) {
          console.log(e);
          // Only log parse error if the error message looks like JSON, otherwise skip
          if (
            typeof error.message === 'string' &&
            error.message.trim().startsWith('{')
          ) {
            this.logger.error(
              `Failed to parse error message for ${cred.username}: ${e.message}`,
            );
          }
        }
        return false;
      }
    } catch (err) {
      this.logger.error(
        `Unexpected error during login for ${cred.username}: ${err.message}`,
      );
      return false;
    }
  }

  private async initClient() {
    try {
      this.scraper = new Scraper({
        transform: {
          request: (input, init) => {
            const mergedInit = { ...init };
            if (this.proxyAgent) {
              (mergedInit as any).dispatcher = this.proxyAgent;
            }
            if (!mergedInit.headers) {
              mergedInit.headers = {};
            }
            // Reduced timeouts for faster failure detection
            (mergedInit as any).bodyTimeout = 15000;
            (mergedInit as any).headersTimeout = 8000;
            return [input, mergedInit];
          },
        },
      });

      this.logger.log(`Twitter client initialized successfully`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize Twitter client: ${error.message}`,
      );
      throw error;
    }
  }
}
