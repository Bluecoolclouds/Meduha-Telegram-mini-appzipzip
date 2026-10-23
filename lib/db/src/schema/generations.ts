import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { meduhaAccounts } from './meduha';
import { meduhaAiChannels, meduhaAiModels } from './admin';
import { meduhaCreditReservations } from './finance';

export type MeduhaGenerationInput = {
  prompt: string;
  duration: number;
  aspect_ratio: string;
  resolution: string;
};

export const meduhaGenerationJobs = pgTable('meduha_generation_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => meduhaAccounts.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => meduhaAiModels.id),
  channelId: text('channel_id').notNull().references(() => meduhaAiChannels.id),
  creditPrice: integer('credit_price').notNull(),
  reservationId: text('reservation_id').references(() => meduhaCreditReservations.id),
  idempotencyKey: text('idempotency_key').notNull(),
  requestId: text('request_id'),
  status: text('status', { enum: ['awaiting_reservation', 'queued', 'submitting', 'unknown', 'in_progress', 'finalizing', 'completed', 'failed'] }).notNull().default('awaiting_reservation'),
  input: jsonb('input').$type<MeduhaGenerationInput>().notNull(),
  resultUrl: text('result_url'),
  errorMessage: text('error_message'),
  providerStatus: text('provider_status'),
  resolutionOutcome: text('resolution_outcome', { enum: ['completed', 'failed'] }),
  resolutionBy: text('resolution_by'),
  resolutionReason: text('resolution_reason'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('meduha_generation_jobs_account_idempotency_uq').on(table.accountId, table.idempotencyKey),
  uniqueIndex('meduha_generation_jobs_request_id_uq').on(table.requestId),
  index('meduha_generation_jobs_queue_idx').on(table.status, table.createdAt),
  index('meduha_generation_jobs_account_created_idx').on(table.accountId, table.createdAt),
]);
export type MeduhaGenerationJobRow = typeof meduhaGenerationJobs.$inferSelect;
