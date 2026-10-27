import { pgTable, text, timestamp, integer, boolean, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const meduhaBotContacts = pgTable('meduha_bot_contacts', {
  id: text('id').primaryKey(),
  subscribed: boolean('subscribed').notNull().default(false),
  reachable: boolean('reachable').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const meduhaBroadcasts = pgTable('meduha_broadcasts', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  title: text('title').notNull(),
  text: text('text').notNull(),
  mediaId: text('media_id'),
  buttons: jsonb('buttons').notNull().default([]),
  status: text('status').notNull().default('draft'),
  testedAt: timestamp('tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const meduhaBroadcastMedia = pgTable('meduha_broadcast_media', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  contentType: text('content_type').notNull(),
  telegramFileId: text('telegram_file_id'),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const meduhaBroadcastDeliveries = pgTable('meduha_broadcast_deliveries', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => meduhaBroadcasts.id),
  contactId: text('contact_id').notNull().references(() => meduhaBotContacts.id),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAt: timestamp('next_at', { withTimezone: true }).notNull().defaultNow(),
  telegramMessageId: text('telegram_message_id'),
  errorCode: text('error_code'),
}, table => [
  uniqueIndex('meduha_broadcast_deliveries_campaign_contact').on(table.campaignId, table.contactId),
  index('meduha_broadcast_pending_idx').on(table.nextAt).where(sql`${table.status}='pending'`),
]);
