import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { meduhaAccounts } from './meduha';

// A singleton records the original administrator; it must never be reassigned
// merely because an older account was removed or a new session was created.
export const meduhaTemplateAdmin = pgTable('meduha_template_admin', {
  slot: integer('slot').primaryKey(),
  telegramId: text('telegram_id').notNull(),
});
export const meduhaUploads = pgTable('meduha_uploads', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => meduhaAccounts.id),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  finalized: boolean('finalized').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const meduhaTemplates = pgTable('meduha_templates', {
  id: text('id').primaryKey(),
  sequence: serial('sequence').notNull().unique(),
  ownerId: text('owner_id').notNull().references(() => meduhaAccounts.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  kind: text('kind', { enum: ['photo', 'video', 'audio'] }).notNull(),
  poster: text('poster').notNull(),
  videoUrl: text('video_url'),
  audioUrl: text('audio_url'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  prompt: text('prompt').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  sourceUrl: text('source_url'),
  credit: text('credit'),
  parameters: jsonb('parameters').$type<{ model: string; style: string; ratio: string; duration: string }>().notNull(),
  status: text('status', { enum: ['draft', 'pending', 'published'] }).notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('meduha_templates_public_page').on(table.status, table.sequence),
  index('meduha_templates_owner_page').on(table.ownerId, table.sequence),
]);

export const meduhaTemplateLikes = pgTable('meduha_template_likes', {
  userId: text('user_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull().references(() => meduhaTemplates.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.templateId] }),
  index('meduha_template_likes_template').on(table.templateId),
]);
export const meduhaTemplateSaves = pgTable('meduha_template_saves', {
  userId: text('user_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull().references(() => meduhaTemplates.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.templateId] }),
  index('meduha_template_saves_template').on(table.templateId),
]);
