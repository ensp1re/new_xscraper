import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { TwitterClientProvider } from './twitter-client.provider';
import { SearchMode } from './enums/search-mode.enum';
import { TwitterAccountDto } from './dto/twitter-account.dto';
import { TweetResponseDto } from './dto/tweet-response.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Profile, Tweet } from 'agent-twitter-client';
import { TweetProfileResponse } from 'src/interfaces/main.interface';

@Injectable()
export class TwitterService {
  private readonly logger = new Logger(TwitterService.name);
  private readonly dataFile = 'data.json';

  constructor(private readonly twitterClientProvider: TwitterClientProvider) {}

  async searchTweets(
    query: string,
    mode: SearchMode = SearchMode.Latest,
    cursor: string = '',
  ): Promise<{
    tweets: TweetResponseDto[];
    next?: string;
    previous?: string;
  }> {
    this.logger.log(`Searching tweets with query: ${query}, mode: ${mode}`);

    const client = this.twitterClientProvider.getClient();
    const response = await client.fetchTweetsSearch(query, mode, cursor);

    if (!response || !response.tweets) {
      return {
        tweets: [],
        next: undefined,
        previous: undefined,
      };
    }

    return {
      tweets: response.tweets.map((tweet) => ({
        id: tweet.id,
        conversationId: tweet.conversationId,
        name: tweet.name,
        username: tweet.username || tweet.permanentUrl?.split('/')[3],
        permanentUrl: tweet.permanentUrl,
        text: tweet.text || this.extractTextFromHtml(tweet.html),
        html: tweet.html,
        likes: tweet.likes,
        retweets: tweet.retweets,
        replies: tweet.replies,
        bookmarkCount: tweet.bookmarkCount,
        views: tweet.views,
        timestamp: tweet.timestamp,
        timeParsed: tweet.timeParsed,
        hashtags: tweet.hashtags,
        mentions: tweet.mentions,
        photos: tweet.photos,
        videos: tweet.videos,
        isQuoted: tweet.isQuoted,
        isReply: tweet.isReply,
        isRetweet: tweet.isRetweet,
        isPin: tweet.isPin,
        sensitiveContent: tweet.sensitiveContent,
      })),
      next: response.next,
      previous: response.previous,
    };
  }

  async getProfile(username: string): Promise<Profile | null> {
    this.logger.log(`Fetching profile for username: ${username}`);

    const client = this.twitterClientProvider.getClient();
    const response = await client.getProfile(username);

    if (!response) {
      return null;
    }
    // Remove circular references if any
    return JSON.parse(
      JSON.stringify(response, (key, value) => {
        if (key === 'inReplyToStatus') return undefined;
        return value;
      }),
    );
  }

  async getTweets(
    username: string,
    count: number,
  ): Promise<TweetProfileResponse[] | null> {
    this.logger.log(
      `Fetching tweets for username: ${username}, count: ${count}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweets(username, count);

    if (!response) {
      return null;
    }

    return response;
  }

  async getTweetsAndReplies(
    username: string,
    count: number,
  ): Promise<any[] | null> {
    this.logger.log(
      `Fetching tweets and replies for username: ${username}, count: ${count}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweetsAndReplies(username, count);

    if (!response) {
      return null;
    }

    return response;
  }

  async getLatestTweet(username: string): Promise<TweetProfileResponse | null> {
    this.logger.log(`Fetching latest tweet for username: ${username}`);

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweets(username, 1);

    if (!response || response.length === 0) {
      return null;
    }

    return response[0];
  }

  async getProfileByUserId(userId: string): Promise<Profile | null> {
    this.logger.log(`Fetching screen name for user ID: ${userId}`);

    const client = this.twitterClientProvider.getClient();
    const response = await client.getProfileByUserId(userId);

    if (!response) {
      return null;
    }

    return response;
  }

  async getUserTweetsByUserId(
    userId: string,
    maxTweets?: number,
    cursor?: string,
  ): Promise<{
    tweets: Tweet[];
    next?: string;
  } | null> {
    this.logger.log(
      `Fetching tweets for user ID: ${userId}, maxTweets: ${maxTweets}, cursor: ${cursor}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.getUserTweetsByUserId(
      userId,
      maxTweets,
      cursor,
    );

    if (!response) {
      return null;
    }

    return {
      tweets: response.tweets,
      next: response.next || undefined,
    };
  }

  async getTweet(tweetId: string): Promise<Tweet | null> {
    this.logger.log(`Fetching tweet with ID: ${tweetId}`);

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweet(tweetId);

    if (!response) {
      return null;
    }

    return JSON.parse(
      JSON.stringify(response, (key, value) => {
        if (key === 'inReplyToStatus') return undefined;
        return value;
      }),
    );
  }

  async getTweetReplies(
    tweetId: string,
    cursor?: string,
  ): Promise<{
    replies: Tweet[];
    next?: string;
  } | null> {
    this.logger.log(
      `Fetching replies for tweet ID: ${tweetId}, cursor: ${cursor}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweetReplies(tweetId, cursor);

    if (!response) {
      return null;
    }

    return {
      replies: response.tweets,
      next: response.next || undefined,
    };
  }

  async getTweetQuotes(
    tweetId: string,
    cursor?: string,
  ): Promise<{
    quotes: Tweet[];
    next?: string;
  } | null> {
    this.logger.log(
      `Fetching quotes for tweet ID: ${tweetId}, cursor: ${cursor}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.getTweetQuotes(tweetId, cursor);

    if (!response) {
      return null;
    }

    return {
      quotes: response.tweets,
      next: response.next || undefined,
    };
  }

  async getProfileFollowers(
    userId: string,
    maxProfiles: number,
    cursor?: string,
  ): Promise<{
    profiles: Profile[];
    next?: string;
  } | null> {
    this.logger.log(
      `Fetching followers for user ID: ${userId}, maxProfiles: ${maxProfiles}, cursor: ${cursor}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.fetchProfileFollowers(
      userId,
      maxProfiles,
      cursor,
    );

    console.log(response.profiles.length, 'followers');

    if (!response) {
      return null;
    }

    return {
      profiles: response.profiles,
      next: response.next || undefined,
    };
  }

  async getProfileFollowing(
    userId: string,
    maxProfiles: number,
    cursor?: string,
  ): Promise<{
    profiles: Profile[];
    next?: string;
  } | null> {
    this.logger.log(
      `Fetching following profiles for user ID: ${userId}, maxProfiles: ${maxProfiles}, cursor: ${cursor}`,
    );

    const client = this.twitterClientProvider.getClient();
    const response = await client.fetchProfileFollowing(
      userId,
      maxProfiles,
      cursor,
    );

    if (!response) {
      return null;
    }

    return {
      profiles: response.profiles,
      next: response.next || undefined,
    };
  }

  private extractTextFromHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
  }

  async getAllAccounts(): Promise<TwitterAccountDto[]> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      // Sanitize sensitive data
      return accounts.map((account) => this.sanitizeAccount(account));
    } catch (error) {
      this.logger.error(`Failed to load accounts: ${error.message}`);
      return [];
    }
  }

  async getAccountByUsername(username: string): Promise<TwitterAccountDto> {
    const accounts = await this.getAllAccounts();
    const account = accounts.find((acc) => acc.username === username);

    if (!account) {
      throw new NotFoundException(
        `Account with username ${username} not found`,
      );
    }

    return account;
  }

  async addAccount(accountDto: TwitterAccountDto): Promise<TwitterAccountDto> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      // Check if account already exists
      const existingAccount = accounts.find(
        (acc) => acc.username === accountDto.username,
      );
      if (existingAccount) {
        throw new Error(
          `Account with username ${accountDto.username} already exists`,
        );
      }

      // Add new account
      const newAccount = {
        ...accountDto,
        cookie: [],
        usable: true,
      };

      accounts.push(newAccount);
      await fs.writeFile(this.dataFile, JSON.stringify(accounts, null, 2));

      return this.sanitizeAccount(newAccount);
    } catch (error) {
      this.logger.error(`Failed to add account: ${error.message}`);
      throw error;
    }
  }

  async updateAccount(
    username: string,
    updateDto: UpdateAccountDto,
  ): Promise<TwitterAccountDto> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      const accountIndex = accounts.findIndex(
        (acc) => acc.username === username,
      );
      if (accountIndex === -1) {
        throw new NotFoundException(
          `Account with username ${username} not found`,
        );
      }

      // Update account
      accounts[accountIndex] = {
        ...accounts[accountIndex],
        ...updateDto,
      };

      await fs.writeFile(this.dataFile, JSON.stringify(accounts, null, 2));

      return this.sanitizeAccount(accounts[accountIndex]);
    } catch (error) {
      this.logger.error(`Failed to update account: ${error.message}`);
      throw error;
    }
  }

  async deleteAccount(username: string): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      const accountIndex = accounts.findIndex(
        (acc) => acc.username === username,
      );
      if (accountIndex === -1) {
        throw new NotFoundException(
          `Account with username ${username} not found`,
        );
      }

      // Remove account
      accounts.splice(accountIndex, 1);
      await fs.writeFile(this.dataFile, JSON.stringify(accounts, null, 2));
    } catch (error) {
      this.logger.error(`Failed to delete account: ${error.message}`);
      throw error;
    }
  }

  async clearCookies(username: string): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      const accountIndex = accounts.findIndex(
        (acc) => acc.username === username,
      );
      if (accountIndex === -1) {
        throw new NotFoundException(
          `Account with username ${username} not found`,
        );
      }

      // Clear cookies
      accounts[accountIndex].cookie = [];

      await fs.writeFile(this.dataFile, JSON.stringify(accounts, null, 2));
    } catch (error) {
      this.logger.error(`Failed to clear cookies: ${error.message}`);
      throw error;
    }
  }

  async clearAllCookies(): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      // Clear cookies for all accounts
      accounts.forEach((account) => {
        account.cookie = [];
      });

      await fs.writeFile(this.dataFile, JSON.stringify(accounts, null, 2));
    } catch (error) {
      this.logger.error(`Failed to clear all cookies: ${error.message}`);
      throw error;
    }
  }

  async setProxy(proxyUrl: string): Promise<void> {
    this.twitterClientProvider.setProxy(proxyUrl);
  }

  async deleteLockedAccounts(): Promise<{
    deletedCount: number;
    remainingCount: number;
    message: string;
  }> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const accounts = JSON.parse(data);

      const initialCount = accounts.length;

      // Filter out locked accounts
      const activeAccounts = accounts.filter((account) => !account.isLocked);
      const deletedCount = initialCount - activeAccounts.length;

      // Save the filtered accounts back to file
      await fs.writeFile(
        this.dataFile,
        JSON.stringify(activeAccounts, null, 2),
      );

      this.logger.log(
        `Deleted ${deletedCount} locked accounts. ${activeAccounts.length} accounts remaining.`,
      );

      return {
        deletedCount,
        remainingCount: activeAccounts.length,
        message: `Successfully deleted ${deletedCount} locked/suspended accounts. ${activeAccounts.length} active accounts remaining.`,
      };
    } catch (error) {
      this.logger.error(`Failed to delete locked accounts: ${error.message}`);
      throw error;
    }
  }

  private sanitizeAccount(account: any): TwitterAccountDto {
    const { password, cookie, ...sanitizedAccount } = account;
    return {
      ...sanitizedAccount,
      hasCookies: Array.isArray(cookie) && cookie.length > 0,
    };
  }
}
