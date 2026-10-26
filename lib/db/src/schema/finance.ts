import { createInsertSchema } from 'drizzle-zod';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { meduhaAccounts } from './meduha';

export const meduhaFinanceLedger = pgTable('meduha_finance_ledger', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => meduhaAccounts.id),
  actorId: text('actor_id').notNull(),
  kind: text('kind', { enum: ['adjustment', 'topup', 'reserve', 'settlement', 'release', 'refund'] }).notNull(),
  delta: integer('delta').notNull().default(0),
  reservedDelta: integer('reserved_delta').notNull().default(0),
  budgetDelta: integer('budget_delta').notNull().default(0),
  budgetDay: date('budget_day', { mode: 'string' }),
  reservationId: text('reservation_id'),
  reason: text('reason').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('meduha_finance_ledger_idempotency_uq').on(table.idempotencyKey),
  index('meduha_finance_ledger_account_created_idx').on(table.accountId, table.createdAt),
  index('meduha_finance_ledger_budget_day_idx').on(table.budgetDay),
  check('meduha_finance_ledger_kind_check', sql`${table.kind} in ('adjustment', 'topup', 'reserve', 'settlement', 'release', 'refund')`),
]);
export const insertMeduhaFinanceLedgerSchema = createInsertSchema(meduhaFinanceLedger).omit({ createdAt: true });
export type MeduhaFinanceLedgerRow = typeof meduhaFinanceLedger.$inferSelect;

export const meduhaCreditReservations = pgTable('meduha_credit_reservations', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => meduhaAccounts.id),
  actorId: text('actor_id').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['held', 'settled', 'released', 'refunded'] }).notNull().default('held'),
  modelId: text('model_id'),
  channelId: text('channel_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
}, table => [
  uniqueIndex('meduha_credit_reservations_idempotency_uq').on(table.idempotencyKey),
  index('meduha_credit_reservations_account_created_idx').on(table.accountId, table.createdAt),
  index('meduha_credit_reservations_status_idx').on(table.status),
  check('meduha_credit_reservations_amount_check', sql`${table.amount} > 0`),
  check('meduha_credit_reservations_status_check', sql`${table.status} in ('held', 'settled', 'released', 'refunded')`),
]);
export const insertMeduhaCreditReservationSchema = createInsertSchema(meduhaCreditReservations).omit({
  createdAt: true, updatedAt: true, settledAt: true, releasedAt: true, refundedAt: true,
});
export type MeduhaCreditReservationRow = typeof meduhaCreditReservations.$inferSelect;

export const meduhaFinanceSettings = pgTable('meduha_finance_settings', {
  id: integer('id').notNull().primaryKey().default(1),
  spendingEnabled: boolean('spending_enabled').notNull().default(false),
  dailyCreditLimit: integer('daily_credit_limit').notNull().default(0),
  perAccountDailyCreditLimit: integer('per_account_daily_credit_limit').notNull().default(0),
  maxActiveReservations: integer('max_active_reservations').notNull().default(3),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
}, table => [
  check('meduha_finance_settings_singleton_check', sql`${table.id} = 1`),
  check('meduha_finance_settings_daily_limit_check', sql`${table.dailyCreditLimit} >= 0`),
  check('meduha_finance_settings_account_daily_limit_check', sql`${table.perAccountDailyCreditLimit} >= 0`),
  check('meduha_finance_settings_active_limit_check', sql`${table.maxActiveReservations} >= 0`),
]);
export const insertMeduhaFinanceSettingsSchema = createInsertSchema(meduhaFinanceSettings).omit({ updatedAt: true });
export type MeduhaFinanceSettingsRow = typeof meduhaFinanceSettings.$inferSelect;

/** One global idempotency namespace shared by every finance mutation. */
export const meduhaFinanceIdempotency = pgTable('meduha_finance_idempotency', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  operation: text('operation').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  ledgerId: text('ledger_id').notNull(),
  reservationId: text('reservation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('meduha_finance_idempotency_created_idx').on(table.createdAt),
]);
export type MeduhaFinanceIdempotencyRow = typeof meduhaFinanceIdempotency.$inferSelect;
