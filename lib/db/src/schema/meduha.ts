import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

export const meduhaAccounts = pgTable('meduha_accounts', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code').notNull().default('ru'),
  credits: integer('credits').notNull().default(0),
  subscription: text('subscription').notNull().default('none'),
  notifications: boolean('notifications').notNull().default(true),
  quality: boolean('quality').notNull().default(true),
  blocked: boolean('blocked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const insertMeduhaAccountSchema = createInsertSchema(meduhaAccounts).omit({createdAt:true, updatedAt:true});
export type MeduhaAccountRow = typeof meduhaAccounts.$inferSelect;

export const meduhaSessions = pgTable('meduha_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const insertMeduhaSessionSchema = createInsertSchema(meduhaSessions).omit({createdAt:true});

export const meduhaDrafts = pgTable('meduha_drafts', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<{
    title:string;type:'photo'|'video'|'music';prompt:string;style:string;
    model:string;ratio:string;duration:string;referenceName?:string;
    recipe?: unknown; recipeSourceId?: string | null;
  }>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({columns:[table.userId,table.id]})]);
export const insertMeduhaDraftSchema = createInsertSchema(meduhaDrafts).omit({updatedAt:true});

export const meduhaWorks = pgTable('meduha_works', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: text('type', {enum:['photo','video','music']}).notNull(),
  status: text('status', {enum:['queued','processing','completed','failed']}).notNull(),
  createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow(),
});
export const insertMeduhaWorkSchema = createInsertSchema(meduhaWorks).omit({createdAt:true});
