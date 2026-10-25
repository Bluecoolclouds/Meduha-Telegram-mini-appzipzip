import { assertPhotoQuote, photoPricingFingerprint, photoQuotedPrice, verifyPhotoQuote } from './photo-pricing';
import type { PhotoMetadata } from './photo';
import { randomUUID } from 'node:crypto';
import { pool, type PoolClient } from '@workspace/db';
import {
  GENJUTSU_ENDPOINTS, configuredGenjutsuPrice, genjutsuPricingFingerprint,
  type GenjutsuQuoteClaims,
} from './genjutsu';

export type FinanceErrorCode =
  | 'INVALID_INPUT'
  | 'ACCOUNT_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'SPENDING_DISABLED'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'ACTIVE_RESERVATION_LIMIT'
  | 'STALE_PRICE_QUOTE'
  | 'INVALID_RESERVATION_STATE';

export class FinanceError extends Error {
  constructor(public readonly code: FinanceErrorCode, message: string) {
    super(message);
    this.name = 'FinanceError';
  }
}

export type FinanceLedgerEntry = {
  id: string;
  accountId: string;
  actorId: string;
  kind: 'adjustment' | 'reserve' | 'settlement' | 'release' | 'refund';
  delta: number;
  reservedDelta: number;
  budgetDelta: number;
  budgetDay: string | null;
  reservationId: string | null;
  reason: string;
  idempotencyKey: string;
  createdAt: Date;
};

export type FinanceReservation = {
  id: string;
  accountId: string;
  actorId: string;
  amount: number;
  reason: string;
  status: 'held' | 'settled' | 'released' | 'refunded';
  modelId: string | null;
  channelId: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
  releasedAt: Date | null;
  refundedAt: Date | null;
};

export type FinanceWallet = {
  accountId: string;
  balance: number;
  reserved: number;
  available: number;
  dailyUsage: {
    utcDay: string;
    activeReserves: number;
    netSpent: number;
    perAccountDailyCreditLimit: number;
    remaining: number;
  };
  ledger: FinanceLedgerEntry[];
  reservations: FinanceReservation[];
  pagination: { limit: number; offset: number; totalLedger: number; totalReservations: number };
};

export type FinanceSettings = {
  spendingEnabled: boolean;
  dailyCreditLimit: number;
  perAccountDailyCreditLimit: number;
  maxActiveReservations: number;
  updatedAt: Date;
  updatedBy: string | null;
};

export type FinanceStats = {
  accounts: number;
  balance: number;
  reserved: number;
  available: number;
  activeReservations: number;
  settledToday: number;
  refundedToday: number;
  dailyBudgetUsed: number;
  dailyCreditLimit: number;
  spendingEnabled: boolean;
  utcDay: string;
};

export type AdjustWalletInput = {
  accountId: string;
  actorId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
};

export type ReserveCreditsInput = {
  accountId: string;
  actorId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  modelId?: string;
  channelId?: string;
  genjutsuQuote?: Pick<GenjutsuQuoteClaims, 'scenario' | 'resolution' | 'duration' | 'creditPrice' | 'pricingFingerprint'>;
  photoBatch?: number;
  photoQuote?: { token: string; metadata: PhotoMetadata; requestKey: string };
};

export type UpdateFinanceSettingsInput = {
  spendingEnabled?: boolean;
  dailyCreditLimit?: number;
  perAccountDailyCreditLimit?: number;
  maxActiveReservations?: number;
};

export type FinanceMutationResult = {
  wallet: FinanceWallet;
  ledgerEntry: FinanceLedgerEntry;
  reservation: FinanceReservation | null;
  replayed: boolean;
};

type FinanceOperation = 'adjustWallet' | 'reserveCredits' | 'settleReservation' | 'releaseReservation' | 'refundReservation';
type RawRow = Record<string, any>;
type MutationOutcome = { ledger: FinanceLedgerEntry; reservationId: string | null; accountId: string };
const FINANCE_LOCK_ID = 1_967_011_431;
const MAX_CREDIT_BALANCE = 2_147_483_647;

function fail(code: FinanceErrorCode, message: string): never {
  throw new FinanceError(code, message);
}

function requiredString(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    fail('INVALID_INPUT', `${field} must be a non-empty string of at most 512 characters`);
  }
  return value;
}

function integer(value: number, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('INVALID_INPUT', `${field} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function optionalModelLimit(limits: unknown, key: string): number | null {
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
    fail('INVALID_INPUT', 'Configured model limits must be an object');
  }
  const value = (limits as Record<string, unknown>)[key];
  if (value === undefined) return null;
  if (typeof value !== 'number') fail('INVALID_INPUT', `Model ${key} must be a nonnegative integer`);
  return integer(value, `model ${key}`, 0, MAX_CREDIT_BALANCE);
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(day) && day >= 1 && day <= daysByMonth[month - 1];
}

function sqlDateString(value: unknown): string | null {
  if (value === null) return null;
  let year: number;
  let month: number;
  let day: number;
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error('Invalid SQL DATE returned for finance ledger budgetDay');
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    // PostgreSQL's DATE parser returns local midnight; local getters preserve that calendar date.
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else {
    throw new Error('Invalid SQL DATE returned for finance ledger budgetDay');
  }
  if (!isValidCalendarDate(year, month, day)) {
    throw new Error('Invalid SQL DATE returned for finance ledger budgetDay');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mapLedger(row: RawRow): FinanceLedgerEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    actorId: row.actor_id,
    kind: row.kind,
    delta: Number(row.delta),
    reservedDelta: Number(row.reserved_delta),
    budgetDelta: Number(row.budget_delta),
    budgetDay: sqlDateString(row.budget_day),
    reservationId: row.reservation_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    createdAt: asDate(row.created_at)!,
  };
}

function mapReservation(row: RawRow): FinanceReservation {
  return {
    id: row.id,
    accountId: row.account_id,
    actorId: row.actor_id,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    modelId: row.model_id,
    channelId: row.channel_id,
    idempotencyKey: row.idempotency_key,
    createdAt: asDate(row.created_at)!,
    updatedAt: asDate(row.updated_at)!,
    settledAt: asDate(row.settled_at),
    releasedAt: asDate(row.released_at),
    refundedAt: asDate(row.refunded_at),
  };
}

function mapSettings(row: RawRow): FinanceSettings {
  return {
    spendingEnabled: row.spending_enabled,
    dailyCreditLimit: Number(row.daily_credit_limit),
    perAccountDailyCreditLimit: Number(row.per_account_daily_credit_limit),
    maxActiveReservations: Number(row.max_active_reservations),
    updatedAt: asDate(row.updated_at)!,
    updatedBy: row.updated_by,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function accountDailyBudgetUsed(held: number, settledNet: number): number {
  return Math.max(0, held + settledNet);
}

async function ensureSettings(client: PoolClient): Promise<FinanceSettings> {
  await client.query(
    `INSERT INTO meduha_finance_settings (id, spending_enabled, daily_credit_limit, max_active_reservations)
     VALUES (1, false, 0, 3) ON CONFLICT (id) DO NOTHING`,
  );
  const { rows } = await client.query('SELECT * FROM meduha_finance_settings WHERE id = 1');
  return mapSettings(rows[0]);
}

async function walletWithClient(client: PoolClient, accountId: string, limit = 50, offset = 0): Promise<FinanceWallet> {
  const day = utcDay();
  const boundedLimit = Math.max(1, Math.min(100, integer(limit, 'limit', 0)));
  const boundedOffset = integer(offset, 'offset', 0);
  const { rows: accountRows } = await client.query('SELECT credits FROM meduha_accounts WHERE id = $1', [accountId]);
  if (!accountRows[0]) fail('ACCOUNT_NOT_FOUND', 'Account not found');
  const balance = Number(accountRows[0].credits);
  const reservationSum = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM meduha_credit_reservations WHERE account_id = $1 AND status = 'held'`,
    [accountId],
  );
  const ledgerCount = await client.query('SELECT COUNT(*)::bigint AS total FROM meduha_finance_ledger WHERE account_id = $1', [accountId]);
  const reservationCount = await client.query('SELECT COUNT(*)::bigint AS total FROM meduha_credit_reservations WHERE account_id = $1', [accountId]);
  const ledgerPage = await client.query(
    'SELECT * FROM meduha_finance_ledger WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3',
    [accountId, boundedLimit, boundedOffset],
  );
  const reservationPage = await client.query(
    'SELECT * FROM meduha_credit_reservations WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3',
    [accountId, boundedLimit, boundedOffset],
  );
  const reserved = Number(reservationSum.rows[0].total);
  // Read within the caller's snapshot, without creating settings or mutating finance state.
  // budget_day attributes refunds to the original settlement day, not their creation day.
  const { rows: usageRows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(budget_delta) FROM meduha_finance_ledger
         WHERE account_id = $1 AND budget_day = $2), 0)::bigint AS net_spent,
       COALESCE((SELECT per_account_daily_credit_limit FROM meduha_finance_settings WHERE id = 1), 0) AS daily_limit`,
    [accountId, day],
  );
  const netSpent = Number(usageRows[0].net_spent);
  const perAccountDailyCreditLimit = Number(usageRows[0].daily_limit);
  return {
    accountId,
    balance,
    reserved,
    available: balance - reserved,
    dailyUsage: {
      utcDay: day,
      activeReserves: reserved,
      netSpent,
      perAccountDailyCreditLimit,
      remaining: Math.max(0, perAccountDailyCreditLimit - accountDailyBudgetUsed(reserved, netSpent)),
    },
    ledger: ledgerPage.rows.map(mapLedger),
    reservations: reservationPage.rows.map(mapReservation),
    pagination: {
      limit: boundedLimit,
      offset: boundedOffset,
      totalLedger: Number(ledgerCount.rows[0].total),
      totalReservations: Number(reservationCount.rows[0].total),
    },
  };
}

async function readSnapshot<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockGlobalBudget(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [FINANCE_LOCK_ID]);
}

async function lockAccount(client: PoolClient, accountId: string): Promise<number> {
  const { rows } = await client.query('SELECT credits FROM meduha_accounts WHERE id = $1 FOR UPDATE', [accountId]);
  if (!rows[0]) fail('ACCOUNT_NOT_FOUND', 'Account not found');
  return Number(rows[0].credits);
}

async function insertLedger(
  client: PoolClient,
  input: Omit<FinanceLedgerEntry, 'id' | 'createdAt'>,
): Promise<FinanceLedgerEntry> {
  const { rows } = await client.query(
    `INSERT INTO meduha_finance_ledger
      (id, account_id, actor_id, kind, delta, reserved_delta, budget_delta, budget_day, reservation_id, reason, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [randomUUID(), input.accountId, input.actorId, input.kind, input.delta, input.reservedDelta,
      input.budgetDelta, input.budgetDay, input.reservationId, input.reason, input.idempotencyKey],
  );
  return mapLedger(rows[0]);
}

async function runMutation(
  operation: FinanceOperation,
  payload: Record<string, unknown>,
  accountId: string,
  idempotencyKey: string,
  perform: (client: PoolClient) => Promise<MutationOutcome>,
): Promise<FinanceMutationResult> {
  return withTransaction(async client => {
    await lockGlobalBudget(client);
    const { rows: existingRows } = await client.query(
      'SELECT * FROM meduha_finance_idempotency WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (existing.operation !== operation || stableJson(existing.payload) !== stableJson(payload)) {
        fail('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different operation or payload');
      }
      const ledgerRows = await client.query('SELECT * FROM meduha_finance_ledger WHERE id = $1', [existing.ledger_id]);
      const reservationRows = existing.reservation_id
        ? await client.query('SELECT * FROM meduha_credit_reservations WHERE id = $1', [existing.reservation_id])
        : { rows: [] };
      const resolvedAccountId = accountId || reservationRows.rows[0]?.account_id || ledgerRows.rows[0]?.account_id;
      const wallet = await walletWithClient(client, resolvedAccountId);
      return {
        wallet,
        ledgerEntry: mapLedger(ledgerRows.rows[0]),
        reservation: reservationRows.rows[0] ? mapReservation(reservationRows.rows[0]) : null,
        replayed: true,
      };
    }

    const outcome = await perform(client);
    await client.query(
      `INSERT INTO meduha_finance_idempotency
        (idempotency_key, operation, payload, ledger_id, reservation_id)
       VALUES ($1,$2,$3::jsonb,$4,$5)`,
      [idempotencyKey, operation, JSON.stringify(payload), outcome.ledger.id, outcome.reservationId],
    );
    const reservationRows = outcome.reservationId
      ? await client.query('SELECT * FROM meduha_credit_reservations WHERE id = $1', [outcome.reservationId])
      : { rows: [] as RawRow[] };
    const wallet = await walletWithClient(client, outcome.accountId);
    return {
      wallet,
      ledgerEntry: outcome.ledger,
      reservation: reservationRows.rows[0] ? mapReservation(reservationRows.rows[0]) : null,
      replayed: false,
    };
  });
}

export async function getWallet(accountId: string, limit = 50, offset = 0): Promise<FinanceWallet> {
  requiredString(accountId, 'accountId');
  return readSnapshot(client => walletWithClient(client, accountId, limit, offset));
}

export async function adjustWallet(input: AdjustWalletInput): Promise<FinanceMutationResult> {
  requiredString(input.accountId, 'accountId');
  requiredString(input.actorId, 'actorId');
  requiredString(input.reason, 'reason');
  requiredString(input.idempotencyKey, 'idempotencyKey');
  integer(input.delta, 'delta', -MAX_CREDIT_BALANCE, MAX_CREDIT_BALANCE);
  if (input.delta === 0) fail('INVALID_INPUT', 'delta must not be zero');
  const payload = { accountId: input.accountId, actorId: input.actorId, delta: input.delta, reason: input.reason };
  return runMutation('adjustWallet', payload, input.accountId, input.idempotencyKey, async client => {
    const balance = await lockAccount(client, input.accountId);
    const newBalance = balance + input.delta;
    if (!Number.isSafeInteger(newBalance) || newBalance < 0 || newBalance > MAX_CREDIT_BALANCE) {
      fail('INSUFFICIENT_CREDITS', 'Adjustment would make the balance invalid');
    }
    const { rows: holdRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM meduha_credit_reservations
       WHERE account_id = $1 AND status = 'held'`,
      [input.accountId],
    );
    if (newBalance < Number(holdRows[0].total)) fail('INSUFFICIENT_CREDITS', 'Adjustment would make available credits negative');
    await client.query('UPDATE meduha_accounts SET credits = $2, updated_at = now() WHERE id = $1', [input.accountId, newBalance]);
    const ledger = await insertLedger(client, {
      accountId: input.accountId, actorId: input.actorId, kind: 'adjustment', delta: input.delta,
      reservedDelta: 0, budgetDelta: 0, budgetDay: null, reservationId: null,
      reason: input.reason, idempotencyKey: input.idempotencyKey,
    });
    return { ledger, reservationId: null, accountId: input.accountId };
  });
}

export async function reserveCredits(input: ReserveCreditsInput): Promise<FinanceMutationResult> {
  requiredString(input.accountId, 'accountId');
  requiredString(input.actorId, 'actorId');
  requiredString(input.reason, 'reason');
  requiredString(input.idempotencyKey, 'idempotencyKey');
  integer(input.amount, 'amount', 1, MAX_CREDIT_BALANCE);
  if (input.modelId !== undefined) requiredString(input.modelId, 'modelId');
  if (input.channelId !== undefined) requiredString(input.channelId, 'channelId');
  const payload = {
    accountId: input.accountId, actorId: input.actorId, amount: input.amount, reason: input.reason,
    modelId: input.modelId ?? null, channelId: input.channelId ?? null,
    ...(input.genjutsuQuote ? { genjutsuQuote: input.genjutsuQuote } : {}),
    ...(input.photoBatch !== undefined ? { photoBatch: input.photoBatch } : {}),
    ...(input.photoQuote ? { photoQuote: input.photoQuote } : {}),
  };
  return runMutation('reserveCredits', payload, input.accountId, input.idempotencyKey, async client => {
    const balance = await lockAccount(client, input.accountId);
    const settings = await ensureSettings(client);
    if (!settings.spendingEnabled) fail('SPENDING_DISABLED', 'Credit spending is disabled');
    let boundChannelId: string | null = input.channelId ?? null;
    let modelLimits: unknown = null;
    if (input.modelId) {
      const { rows: modelRows } = await client.query(
        `SELECT id, channel_id, upstream_id, kind, enabled, credit_price, limits, genjutsu_pricing
         FROM meduha_ai_models WHERE id = $1 FOR SHARE`,
        [input.modelId],
      );
      const model = modelRows[0];
      if (!model) fail('INVALID_INPUT', 'Configured model does not exist');
      if (!model.enabled) fail('SPENDING_DISABLED', 'Configured model is disabled');
      if (input.channelId && input.channelId !== model.channel_id) {
        fail('INVALID_INPUT', 'Configured model does not belong to the supplied channel');
      }
      const creditPrice = Number(model.credit_price);
      if (input.genjutsuQuote) {
        const expectedPrice = configuredGenjutsuPrice(creditPrice, model.genjutsu_pricing, input.genjutsuQuote);
        const expectedEndpoint = GENJUTSU_ENDPOINTS[input.genjutsuQuote.scenario];
        if (model.upstream_id !== expectedEndpoint
          || expectedPrice !== input.genjutsuQuote.creditPrice
          || input.amount !== input.genjutsuQuote.creditPrice
          || genjutsuPricingFingerprint(creditPrice, model.genjutsu_pricing) !== input.genjutsuQuote.pricingFingerprint) {
          fail('STALE_PRICE_QUOTE', 'Цена или настройки модели изменились. Запроси новую котировку.');
        }
      } else if (model.kind === 'photo' || input.photoQuote || input.photoBatch !== undefined) {
        if (model.kind !== 'photo' || !input.photoQuote) fail('STALE_PRICE_QUOTE', 'Фото требует подтверждённой сметы.');
        const { token, metadata, requestKey } = input.photoQuote;
        const claims = verifyPhotoQuote(token);
        assertPhotoQuote(claims, input.accountId, model.id, requestKey, metadata, input.amount);
        if (model.upstream_id !== metadata.endpoint
          || claims.pricingFingerprint !== photoPricingFingerprint(creditPrice)
          || photoQuotedPrice(creditPrice, metadata, claims.usdMicros) !== input.amount) {
          fail('STALE_PRICE_QUOTE', 'Цена изменилась. Рассчитай и подтверди новую стоимость.');
        }
      } else if (input.amount !== creditPrice) {
        fail('INVALID_INPUT', 'Reservation amount must equal the configured model credit price');
      }
      boundChannelId = model.channel_id;
      modelLimits = model.limits;
    }
    let channelLimits: { concurrencyLimit: number; dailyCreditLimit: number } | null = null;
    if (boundChannelId) {
      const { rows: channelRows } = await client.query(
        `SELECT id, enabled, concurrency_limit, daily_credit_limit
         FROM meduha_ai_channels WHERE id = $1 FOR SHARE`,
        [boundChannelId],
      );
      const channel = channelRows[0];
      if (!channel) fail('INVALID_INPUT', 'Configured channel does not exist');
      if (!channel.enabled) fail('SPENDING_DISABLED', 'Configured channel is disabled');
      channelLimits = {
        concurrencyLimit: integer(Number(channel.concurrency_limit), 'channel concurrencyLimit', 0, MAX_CREDIT_BALANCE),
        dailyCreditLimit: integer(Number(channel.daily_credit_limit), 'channel dailyCreditLimit', 0, MAX_CREDIT_BALANCE),
      };
    }
    // Capture one day after acquiring the transaction lock. All checks in this
    // reservation use it, even if the wall clock crosses midnight during SQL.
    const day = utcDay();
    const { rows: totals } = await client.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM meduha_credit_reservations WHERE status = 'held'), 0)::bigint AS global_held,
         COALESCE((SELECT SUM(amount) FROM meduha_credit_reservations WHERE account_id = $2 AND status = 'held'), 0)::bigint AS account_held,
         COALESCE((SELECT SUM(budget_delta) FROM meduha_finance_ledger WHERE budget_day = $1), 0)::bigint AS settled_net,
         COALESCE((SELECT SUM(budget_delta) FROM meduha_finance_ledger WHERE budget_day = $1 AND account_id = $2), 0)::bigint AS account_settled_net,
         (SELECT COUNT(*) FROM meduha_credit_reservations WHERE status = 'held')::bigint AS active`,
      [day, input.accountId],
    );
    const accountHeld = Number(totals[0].account_held);
    if (balance - accountHeld < input.amount) fail('INSUFFICIENT_CREDITS', 'Insufficient available credits');
    const active = Number(totals[0].active);
    if (active >= settings.maxActiveReservations) fail('ACTIVE_RESERVATION_LIMIT', 'Active reservation limit reached');
    const budgetUsed = Math.max(0, Number(totals[0].global_held) + Number(totals[0].settled_net));
    if (budgetUsed + input.amount > settings.dailyCreditLimit) fail('DAILY_LIMIT_EXCEEDED', 'Daily credit limit would be exceeded');

    // Outstanding holds carry over into the next day until settled or released.
    // Settlement replaces a hold with budget_delta atomically under the same lock.
    const accountBudgetUsed = accountDailyBudgetUsed(accountHeld, Number(totals[0].account_settled_net));
    if (accountBudgetUsed + input.amount > settings.perAccountDailyCreditLimit) {
      fail('DAILY_LIMIT_EXCEEDED', 'Дневной лимит кредитов аккаунта исчерпан. Новый день начинается в 00:00 UTC.');
    }
    if (boundChannelId && channelLimits) {
      const { rows: channelUsageRows } = await client.query(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM meduha_credit_reservations
             WHERE channel_id = $1 AND status = 'held'), 0)::bigint AS held,
           (SELECT COUNT(*) FROM meduha_credit_reservations
             WHERE channel_id = $1 AND status = 'held')::bigint AS active,
           COALESCE((SELECT SUM(l.budget_delta) FROM meduha_finance_ledger l
             JOIN meduha_credit_reservations r ON r.id = l.reservation_id
             WHERE l.budget_day = $2 AND r.channel_id = $1), 0)::bigint AS settled_net`,
        [boundChannelId, day],
      );
      const channelUsage = channelUsageRows[0];
      if (Number(channelUsage.active) >= channelLimits.concurrencyLimit) {
        fail('ACTIVE_RESERVATION_LIMIT', 'Channel active reservation limit reached');
      }
      const channelBudgetUsed = Math.max(0, Number(channelUsage.held) + Number(channelUsage.settled_net));
      if (channelBudgetUsed + input.amount > channelLimits.dailyCreditLimit) {
        fail('DAILY_LIMIT_EXCEEDED', 'Channel daily credit limit would be exceeded');
      }
    }
    if (input.modelId) {
      const concurrencyLimit = optionalModelLimit(modelLimits, 'concurrencyLimit');
      const dailyCreditLimit = optionalModelLimit(modelLimits, 'dailyCreditLimit');
      const { rows: modelUsageRows } = await client.query(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM meduha_credit_reservations
             WHERE model_id = $1 AND status = 'held'), 0)::bigint AS held,
           (SELECT COUNT(*) FROM meduha_credit_reservations
             WHERE model_id = $1 AND status = 'held')::bigint AS active,
           COALESCE((SELECT SUM(l.budget_delta) FROM meduha_finance_ledger l
             JOIN meduha_credit_reservations r ON r.id = l.reservation_id
             WHERE l.budget_day = $2 AND r.model_id = $1), 0)::bigint AS settled_net`,
        [input.modelId, day],
      );
      const modelUsage = modelUsageRows[0];
      if (concurrencyLimit !== null && Number(modelUsage.active) >= concurrencyLimit) {
        fail('ACTIVE_RESERVATION_LIMIT', 'Model active reservation limit reached');
      }
      if (dailyCreditLimit !== null) {
        const modelBudgetUsed = Math.max(0, Number(modelUsage.held) + Number(modelUsage.settled_net));
        if (modelBudgetUsed + input.amount > dailyCreditLimit) {
          fail('DAILY_LIMIT_EXCEEDED', 'Model daily credit limit would be exceeded');
        }
      }
    }

    const reservationReason = input.modelId
      ? input.reason
      : input.channelId
        ? `Manual channel reservation: ${input.reason}`
        : `Manual reservation: ${input.reason}`;
    const reservationId = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO meduha_credit_reservations
        (id, account_id, actor_id, amount, reason, status, model_id, channel_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'held',$6,$7,$8) RETURNING *`,
      [reservationId, input.accountId, input.actorId, input.amount, reservationReason,
        input.modelId ?? null, boundChannelId, input.idempotencyKey],
    );
    const ledger = await insertLedger(client, {
      accountId: input.accountId, actorId: input.actorId, kind: 'reserve', delta: 0,
      reservedDelta: input.amount, budgetDelta: 0, budgetDay: null, reservationId,
      reason: reservationReason, idempotencyKey: input.idempotencyKey,
    });
    return { ledger, reservationId: mapReservation(rows[0]).id, accountId: input.accountId };
  });
}

async function transitionReservation(
  operation: 'settleReservation' | 'releaseReservation' | 'refundReservation',
  input: { reservationId: string; actorId: string; idempotencyKey: string; reason?: string },
): Promise<FinanceMutationResult> {
  requiredString(input.reservationId, 'reservationId');
  requiredString(input.actorId, 'actorId');
  requiredString(input.idempotencyKey, 'idempotencyKey');
  if (input.reason !== undefined) requiredString(input.reason, 'reason');
  const payload = {
    reservationId: input.reservationId,
    actorId: input.actorId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
  return runMutation(operation, payload, '', input.idempotencyKey, async client => {
    const { rows: reservationRows } = await client.query(
      'SELECT * FROM meduha_credit_reservations WHERE id = $1 FOR UPDATE',
      [input.reservationId],
    );
    const reservation = reservationRows[0];
    if (!reservation) fail('RESERVATION_NOT_FOUND', 'Reservation not found');
    const accountId = reservation.account_id as string;
    const balance = await lockAccount(client, accountId);
    const amount = Number(reservation.amount);
    let ledger: FinanceLedgerEntry;
    if (operation === 'settleReservation') {
      if (reservation.status !== 'held') fail('INVALID_RESERVATION_STATE', 'Only held reservations can be settled');
      if (balance < amount) fail('INSUFFICIENT_CREDITS', 'Insufficient credits to settle reservation');
      // Spending disablement blocks new holds, not settlement of an already-authorized hold.
      const { rows: settingsRows } = await client.query('SELECT daily_credit_limit FROM meduha_finance_settings WHERE id = 1');
      const dailyLimit = Number(settingsRows[0]?.daily_credit_limit ?? 0);
      const day = utcDay();
      const { rows: budgetRows } = await client.query(
        `SELECT COALESCE(SUM(budget_delta),0)::bigint AS used
         FROM meduha_finance_ledger WHERE budget_day = $1`,
        [day],
      );
      const heldExcludingThis = await client.query(
        `SELECT COALESCE(SUM(amount),0)::bigint AS total FROM meduha_credit_reservations
         WHERE status = 'held' AND id <> $1`,
        [input.reservationId],
      );
      const currentUsage = Math.max(0, Number(budgetRows[0].used) + Number(heldExcludingThis.rows[0].total));
      if (currentUsage + amount > dailyLimit) fail('DAILY_LIMIT_EXCEEDED', 'Settlement would exceed the daily credit limit');
      await client.query(
        `UPDATE meduha_credit_reservations SET status = 'settled', settled_at = now(), updated_at = now() WHERE id = $1`,
        [input.reservationId],
      );
      await client.query('UPDATE meduha_accounts SET credits = credits - $2, updated_at = now() WHERE id = $1', [accountId, amount]);
      ledger = await insertLedger(client, {
        accountId, actorId: input.actorId, kind: 'settlement', delta: -amount,
        reservedDelta: -amount, budgetDelta: amount, budgetDay: day,
        reservationId: input.reservationId, reason: input.reason ?? reservation.reason, idempotencyKey: input.idempotencyKey,
      });
    } else if (operation === 'releaseReservation') {
      if (reservation.status !== 'held') fail('INVALID_RESERVATION_STATE', 'Only held reservations can be released');
      await client.query(
        `UPDATE meduha_credit_reservations SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1`,
        [input.reservationId],
      );
      ledger = await insertLedger(client, {
        accountId, actorId: input.actorId, kind: 'release', delta: 0,
        reservedDelta: -amount, budgetDelta: 0, budgetDay: null,
        reservationId: input.reservationId, reason: input.reason ?? reservation.reason, idempotencyKey: input.idempotencyKey,
      });
    } else {
      if (reservation.status !== 'settled') fail('INVALID_RESERVATION_STATE', 'Only settled reservations can be refunded');
      const { rows: settlementRows } = await client.query(
        `SELECT budget_day FROM meduha_finance_ledger
         WHERE reservation_id = $1 AND kind = 'settlement' ORDER BY created_at LIMIT 1`,
        [input.reservationId],
      );
      if (!settlementRows[0]) fail('INVALID_RESERVATION_STATE', 'Reservation has no settlement ledger entry');
      if (balance + amount > MAX_CREDIT_BALANCE) fail('INVALID_INPUT', 'Refund would exceed the maximum balance');
      await client.query(
        `UPDATE meduha_credit_reservations SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE id = $1`,
        [input.reservationId],
      );
      await client.query('UPDATE meduha_accounts SET credits = credits + $2, updated_at = now() WHERE id = $1', [accountId, amount]);
      ledger = await insertLedger(client, {
        accountId, actorId: input.actorId, kind: 'refund', delta: amount,
        reservedDelta: 0, budgetDelta: -amount, budgetDay: settlementRows[0].budget_day,
        reservationId: input.reservationId, reason: input.reason ?? reservation.reason, idempotencyKey: input.idempotencyKey,
      });
    }
    return { ledger, reservationId: input.reservationId, accountId };
  });
}

export function settleReservation(input: { reservationId: string; actorId: string; idempotencyKey: string; reason?: string }): Promise<FinanceMutationResult> {
  return transitionReservation('settleReservation', input);
}

export function releaseReservation(input: { reservationId: string; actorId: string; idempotencyKey: string; reason?: string }): Promise<FinanceMutationResult> {
  return transitionReservation('releaseReservation', input);
}

export function refundReservation(input: { reservationId: string; actorId: string; idempotencyKey: string; reason?: string }): Promise<FinanceMutationResult> {
  return transitionReservation('refundReservation', input);
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  return withTransaction(client => ensureSettings(client));
}

export async function updateFinanceSettings(input: UpdateFinanceSettingsInput, actorId: string): Promise<FinanceSettings> {
  requiredString(actorId, 'actorId');
  const keys = Object.keys(input);
  if (keys.length === 0) fail('INVALID_INPUT', 'At least one finance setting must be provided');
  if (input.spendingEnabled !== undefined && typeof input.spendingEnabled !== 'boolean') {
    fail('INVALID_INPUT', 'spendingEnabled must be a boolean');
  }
  if (input.dailyCreditLimit !== undefined) integer(input.dailyCreditLimit, 'dailyCreditLimit', 0, MAX_CREDIT_BALANCE);
  if (input.perAccountDailyCreditLimit !== undefined) integer(input.perAccountDailyCreditLimit, 'perAccountDailyCreditLimit', 0, MAX_CREDIT_BALANCE);
  if (input.maxActiveReservations !== undefined) integer(input.maxActiveReservations, 'maxActiveReservations', 0, MAX_CREDIT_BALANCE);
  return withTransaction(async client => {
    await lockGlobalBudget(client);
    await ensureSettings(client);
    const current = await client.query('SELECT * FROM meduha_finance_settings WHERE id = 1 FOR UPDATE');
    const previous = mapSettings(current.rows[0]);
    const next = {
      spendingEnabled: input.spendingEnabled ?? previous.spendingEnabled,
      dailyCreditLimit: input.dailyCreditLimit ?? previous.dailyCreditLimit,
      perAccountDailyCreditLimit: input.perAccountDailyCreditLimit ?? previous.perAccountDailyCreditLimit,
      maxActiveReservations: input.maxActiveReservations ?? previous.maxActiveReservations,
    };
    const { rows } = await client.query(
      `UPDATE meduha_finance_settings
       SET spending_enabled = $1, daily_credit_limit = $2, max_active_reservations = $3,
           updated_by = $4, per_account_daily_credit_limit = $5, updated_at = now()
       WHERE id = 1 RETURNING *`,
      [next.spendingEnabled, next.dailyCreditLimit, next.maxActiveReservations, actorId, next.perAccountDailyCreditLimit],
    );
    return mapSettings(rows[0]);
  });
}

export async function getFinanceStats(): Promise<FinanceStats> {
  return readSnapshot(async client => {
    const day = utcDay();
    const settings = await client.query('SELECT * FROM meduha_finance_settings WHERE id = 1');
    const accountTotals = await client.query(
      'SELECT COUNT(*)::bigint AS accounts, COALESCE(SUM(credits),0)::bigint AS balance FROM meduha_accounts',
    );
    const reservationTotals = await client.query(`SELECT COUNT(*)::bigint AS active, COALESCE(SUM(amount),0)::bigint AS reserved
      FROM meduha_credit_reservations WHERE status = 'held'`);
    const ledgerTotals = await client.query(`SELECT COALESCE(SUM(CASE WHEN kind = 'settlement' THEN -delta ELSE 0 END),0)::bigint AS settled
      FROM meduha_finance_ledger WHERE kind = 'settlement' AND budget_day = $1`, [day]);
    const refundTotals = await client.query(`SELECT COALESCE(SUM(delta),0)::bigint AS refunded
      FROM meduha_finance_ledger WHERE kind = 'refund' AND created_at >= ($1::date AT TIME ZONE 'UTC')
      AND created_at < (($1::date + INTERVAL '1 day') AT TIME ZONE 'UTC')`, [day]);
    const setting = settings.rows[0] ? mapSettings(settings.rows[0]) : {
      spendingEnabled: false, dailyCreditLimit: 0, maxActiveReservations: 3, updatedAt: new Date(0), updatedBy: null,
    };
    const balance = Number(accountTotals.rows[0].balance);
    const reserved = Number(reservationTotals.rows[0].reserved);
    const { rows: budgetRows } = await client.query(
      'SELECT COALESCE(SUM(budget_delta),0)::bigint AS net FROM meduha_finance_ledger WHERE budget_day = $1',
      [day],
    );
    const dailyBudgetUsed = Math.max(0, reserved + Number(budgetRows[0].net));
    return {
      accounts: Number(accountTotals.rows[0].accounts),
      balance,
      reserved,
      available: balance - reserved,
      activeReservations: Number(reservationTotals.rows[0].active),
      settledToday: Number(ledgerTotals.rows[0].settled),
      refundedToday: Number(refundTotals.rows[0].refunded),
      dailyBudgetUsed,
      dailyCreditLimit: setting.dailyCreditLimit,
      spendingEnabled: setting.spendingEnabled,
      utcDay: day,
    };
  });
}
