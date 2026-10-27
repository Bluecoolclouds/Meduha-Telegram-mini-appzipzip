import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

export const meduhaStudioContent = pgTable('meduha_studio_content', {
  key: text('key').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  cover: text('cover'),
  enabled: boolean('enabled').notNull().default(true),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const insertStudioContentSchema = createInsertSchema(meduhaStudioContent);
export type StudioContentRow = typeof meduhaStudioContent.$inferSelect;

export const meduhaStudioContentMedia = pgTable('meduha_studio_content_media', {
  id: uuid('id').primaryKey(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const insertStudioContentMediaSchema = createInsertSchema(meduhaStudioContentMedia);
export type StudioContentMediaRow = typeof meduhaStudioContentMedia.$inferSelect;
