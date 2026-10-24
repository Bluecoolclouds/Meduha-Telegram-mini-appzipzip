import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const meduhaAdminPairings = pgTable('meduha_admin_pairings', {
  codeHash: text('code_hash').primaryKey(),
  adminId: text('admin_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('meduha_admin_pairings_expiry').on(table.expiresAt),
  index('meduha_admin_pairings_consumed').on(table.consumedAt),
]);

export const meduhaAdminSessions = pgTable('meduha_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  adminId: text('admin_id').notNull(),
  authMethod: text('auth_method', { enum: ['telegram', 'temporary'] }).notNull().default('telegram'),
  configFingerprint: text('config_fingerprint'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('meduha_admin_sessions_id').on(table.id),
  index('meduha_admin_sessions_expiry').on(table.expiresAt),
]);

// Shared across API processes/restarts; no credentials or raw client IPs.
export const meduhaAdminLoginAttempts = pgTable('meduha_admin_login_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('meduha_admin_login_attempts_expiry').on(table.expiresAt)]);

export const meduhaAiChannels = pgTable('meduha_ai_channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  adapter: text('adapter').notNull(),
  secretRef: text('secret_ref'),
  enabled: boolean('enabled').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  concurrencyLimit: integer('concurrency_limit').notNull().default(1),
  dailyCreditLimit: integer('daily_credit_limit').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const meduhaAiModels = pgTable('meduha_ai_models', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => meduhaAiChannels.id, { onDelete: 'cascade' }),
  upstreamId: text('upstream_id').notNull(),
  displayName: text('display_name').notNull(),
  kind: text('kind', { enum: ['photo', 'video', 'audio'] }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  creditPrice: integer('credit_price').notNull().default(0),
  genjutsuPricing: jsonb('genjutsu_pricing').$type<{
    scenario: 'genjutsu' | 'object-swap' | 'restyle';
    resolution: '480p' | '720p' | '1080p';
    duration: number;
    creditPrice: number;
  }[]>().notNull().default([]),
  estimatedCost: integer('estimated_cost'),
  limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
  providerSchemaUrl: text('provider_schema_url'),
  providerSchema: jsonb('provider_schema').$type<{
    schemaAvailable: boolean;
    parameters: {
      name: string;
      type: string;
      required: boolean;
      description?: string;
      defaultValue?: string | number | boolean;
      allowedValues?: (string | number | boolean)[];
      minimum?: number;
      maximum?: number;
      minLength?: number;
      maxLength?: number;
      format?: string;
    }[];
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('meduha_ai_models_channel').on(table.channelId)]);

export const meduhaReports = pgTable('meduha_reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull(),
  templateId: text('template_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['pending', 'resolved', 'dismissed'] }).notNull().default('pending'),
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, table => [
  index('meduha_reports_status_created').on(table.status, table.createdAt),
  uniqueIndex('meduha_reports_reporter_template').on(table.reporterId, table.templateId),
]);

export const meduhaAdminAudit = pgTable('meduha_admin_audit', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('meduha_admin_audit_created').on(table.createdAt)]);
