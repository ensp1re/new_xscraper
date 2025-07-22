import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { apiKeys } from './api-keys';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').unique(),
  email: text('email').unique(),
  password: text('password'),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
