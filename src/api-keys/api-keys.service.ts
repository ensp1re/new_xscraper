import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { apiKeys, ApiKey, NewApiKey } from '../database/schema/api-keys';
import { users } from '../database/schema/users';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @Inject('DRIZZLE_ORM')
    private readonly db,
  ) {}

  async create(
    userId: number,
    createApiKeyDto: CreateApiKeyDto,
  ): Promise<ApiKey> {
    const apiKey = randomBytes(32).toString('hex');

    const newApiKey: NewApiKey = {
      userId,
      key: apiKey,
      name: createApiKeyDto.name,
      expiresAt: createApiKeyDto.expiresAt
        ? new Date(createApiKeyDto.expiresAt)
        : null,
      maxCalls: createApiKeyDto.maxCalls || null,
      callsUsed: 0,
    };

    const [createdApiKey] = await this.db
      .insert(apiKeys)
      .values(newApiKey)
      .returning();
    return createdApiKey;
  }

  async findAll(userId?: number): Promise<ApiKey[]> {
    if (userId) {
      return this.db.query.apiKeys.findMany({
        where: eq(apiKeys.userId, userId),
      });
    }
    return this.db.query.apiKeys.findMany();
  }

  async findOne(id: number): Promise<ApiKey> {
    const apiKey = await this.db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, id),
    });

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    return apiKey;
  }

  async findByKey(key: string): Promise<ApiKey & { isAdmin: boolean }> {
    try {
      const result = await this.db
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          key: apiKeys.key,
          name: apiKeys.name,
          status: apiKeys.status,
          expiresAt: apiKeys.expiresAt,
          maxCalls: apiKeys.maxCalls,
          callsUsed: apiKeys.callsUsed,
          lastUsedAt: apiKeys.lastUsedAt,
          createdAt: apiKeys.createdAt,
          updatedAt: apiKeys.updatedAt,
          isAdmin: users.isAdmin,
        })
        .from(apiKeys)
        .innerJoin(users, eq(apiKeys.userId, users.id))
        .where(eq(apiKeys.key, key))
        .limit(1);

      if (!result || result.length === 0) {
        throw new NotFoundException(`API key not found`);
      }

      return result[0];
    } catch (error) {
      this.logger.error(`Error finding API key: ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(id: number, updateApiKeyDto: UpdateApiKeyDto): Promise<ApiKey> {
    const apiKey = await this.findOne(id);
    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    const updates: Partial<any> = {};

    if (updateApiKeyDto.name) {
      updates.name = updateApiKeyDto.name;
    }

    if (updateApiKeyDto.status) {
      updates.status = updateApiKeyDto.status;
    }

    if (updateApiKeyDto.expiresAt !== undefined) {
      updates.expiresAt = updateApiKeyDto.expiresAt
        ? new Date(updateApiKeyDto.expiresAt)
        : null;
    }

    if (updateApiKeyDto.maxCalls !== undefined) {
      updates.maxCalls = updateApiKeyDto.maxCalls;
    }

    updates.updatedAt = new Date();

    const [updatedApiKey] = await this.db
      .update(apiKeys)
      .set(updates)
      .where(eq(apiKeys.id, id))
      .returning();

    return updatedApiKey;
  }

  async remove(id: number): Promise<void> {
    const apiKey = await this.findOne(id);
    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  async incrementUsage(key: string): Promise<ApiKey> {
    try {
      const [updatedApiKey] = await this.db
        .update(apiKeys)
        .set({
          callsUsed: sql`${apiKeys.callsUsed} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(apiKeys.key, key))
        .returning();

      if (!updatedApiKey) {
        throw new NotFoundException(`API key not found`);
      }

      return updatedApiKey;
    } catch (error) {
      this.logger.error(
        `Error incrementing API key usage: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async validateApiKey(
    key: string,
  ): Promise<{ isValid: boolean; apiKey?: ApiKey & { isAdmin: boolean } }> {
    try {
      const apiKey = await this.findByKey(key);

      if (apiKey.status !== 'active') {
        this.logger.warn(
          `API key ${apiKey.id} is not active (status: ${apiKey.status})`,
        );
        return { isValid: false };
      }

      if (
        !apiKey.isAdmin &&
        apiKey.expiresAt &&
        new Date(apiKey.expiresAt) < new Date()
      ) {
        this.logger.warn(`API key ${apiKey.id} has expired`);
        await this.db
          .update(apiKeys)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(apiKeys.id, apiKey.id));
        return { isValid: false };
      }

      if (
        !apiKey.isAdmin &&
        apiKey.maxCalls !== null &&
        apiKey.callsUsed >= apiKey.maxCalls
      ) {
        this.logger.warn(
          `API key ${apiKey.id} has reached maximum calls (${apiKey.maxCalls})`,
        );
        return { isValid: false };
      }

      const updatedApiKey = await this.incrementUsage(key);

      return {
        isValid: true,
        apiKey: {
          ...updatedApiKey,
          isAdmin: apiKey.isAdmin,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error validating API key: ${error.message}`,
        error.stack,
      );
      return { isValid: false };
    }
  }
}
