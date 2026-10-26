import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { meduhaAccounts } from './meduha';
import { meduhaFinanceLedger } from './finance';

/**
 * Immutable purchase snapshots. Amount, currency, credit grant and provider
 * are captured at checkout so future catalog/provider changes cannot rewrite
 * an already-created order.
 */
export const meduhaPaymentOrders = pgTable('meduha_payment_orders', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => meduhaAccounts.id),
  providerId: text('provider_id').notNull(),
  providerPaymentId: text('provider_payment_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  packageId: text('package_id').notNull(),
  termMonths: integer('term_months').notNull(),
  monthlyCredits: integer('monthly_credits').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  paymentUrl: text('payment_url'),
  status: text('status', { enum: ['pending', 'succeeded', 'canceled', 'failed'] }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, table => [
  uniqueIndex('meduha_payment_orders_account_idempotency_uq').on(table.accountId, table.idempotencyKey),
  uniqueIndex('meduha_payment_orders_provider_payment_uq').on(table.providerId, table.providerPaymentId),
  index('meduha_payment_orders_account_created_idx').on(table.accountId, table.createdAt),
  index('meduha_payment_orders_status_idx').on(table.status),
  check('meduha_payment_orders_term_check', sql`${table.termMonths} in (1, 3, 12)`),
  check('meduha_payment_orders_credits_check', sql`${table.monthlyCredits} > 0`),
  check('meduha_payment_orders_amount_check', sql`${table.amountMinor} > 0`),
  check('meduha_payment_orders_status_check', sql`${table.status} in ('pending', 'succeeded', 'canceled', 'failed')`),
  check('meduha_payment_orders_currency_check', sql`length(${table.currency}) = 3`),
]);

/** Monthly grants are separate, durable and independently idempotent. */
export const meduhaPaymentInstallments = pgTable('meduha_payment_installments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => meduhaPaymentOrders.id, { onDelete: 'cascade' }),
  periodIndex: integer('period_index').notNull(),
  credits: integer('credits').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }),
  ledgerId: text('ledger_id').references(() => meduhaFinanceLedger.id),
}, table => [
  uniqueIndex('meduha_payment_installments_order_period_uq').on(table.orderId, table.periodIndex),
  index('meduha_payment_installments_due_idx').on(table.dueAt),
  check('meduha_payment_installments_period_check', sql`${table.periodIndex} >= 0`),
  check('meduha_payment_installments_credits_check', sql`${table.credits} > 0`),
]);
