import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const apiKeyStatusEnum = pgEnum('api_key_status', [
  'active',
  'expired',
  'revoked',
]);

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  key: text('key').unique(),
  name: text('name'),
  status: apiKeyStatusEnum('status').default('active'),
  expiresAt: timestamp('expires_at'),
  maxCalls: integer('max_calls'),
  callsUsed: integer('calls_used').default(0),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
