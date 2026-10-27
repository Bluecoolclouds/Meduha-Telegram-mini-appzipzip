import { randomUUID } from 'node:crypto';
import { pool, type PoolClient } from '@workspace/db';
import { resolveBillingPlan } from './billing-pricing';
import type { VerifiedProviderPayment } from './payment-providers';

export type PaymentOrderRow = {
  id: string;
  account_id: string;
  provider_id: string;
  provider_payment_id: string | null;
  idempotency_key: string;
  package_id: string;
  term_months: number;
  monthly_credits: number;
  amount_minor: number;
  currency: string;
  payment_url: string | null;
  status: 'pending' | 'succeeded' | 'canceled' | 'failed';
  created_at: Date;
  updated_at: Date;
  paid_at: Date | null;
};

async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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

function sameSelection(
  order: PaymentOrderRow,
  input: { packageId: string; termMonths: number; amountMinor: number; credits: number; providerId: string },
): boolean {
  return order.package_id === input.packageId
    && order.term_months === input.termMonths
    && order.amount_minor === input.amountMinor
    && order.monthly_credits === input.credits
    && order.provider_id === input.providerId;
}

export async function createPendingPaymentOrder(input: {
  accountId: string;
  idempotencyKey: string;
  planId: string;
  termMonths: number;
  providerId: string;
}): Promise<PaymentOrderRow> {
  const quote = resolveBillingPlan(input.planId, input.termMonths);
  if (!quote) throw new Error('INVALID_BILLING_SELECTION');
  const selection = {
    packageId: input.planId,
    termMonths: input.termMonths,
    amountMinor: quote.totalAmountMinor,
    credits: quote.credits,
    providerId: input.providerId,
  };

  return transaction(async client => {
    const previous = await client.query<PaymentOrderRow>(
      `SELECT * FROM meduha_payment_orders
       WHERE account_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.accountId, input.idempotencyKey],
    );
    if (previous.rows[0]) {
      if (!sameSelection(previous.rows[0], selection)) throw new Error('IDEMPOTENCY_CONFLICT');
      return previous.rows[0];
    }

    const inserted = await client.query<PaymentOrderRow>(
      `INSERT INTO meduha_payment_orders
        (id, account_id, provider_id, idempotency_key, package_id, term_months, monthly_credits,
         amount_minor, currency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RUB','pending')
       ON CONFLICT (account_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [randomUUID(), input.accountId, input.providerId, input.idempotencyKey,
        input.planId, input.termMonths, quote.credits, quote.totalAmountMinor],
    );
    let order = inserted.rows[0];
    if (!order) {
      const raced = await client.query<PaymentOrderRow>(
        `SELECT * FROM meduha_payment_orders WHERE account_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [input.accountId, input.idempotencyKey],
      );
      order = raced.rows[0];
      if (!order || !sameSelection(order, selection)) throw new Error('IDEMPOTENCY_CONFLICT');
      return order;
    }

    const scheduleIds = Array.from({ length: input.termMonths }, () => randomUUID());
    await client.query(
      `INSERT INTO meduha_payment_installments
        (id, order_id, period_index, credits, due_at)
       SELECT ids.id, $1, schedule.period_index, $2,
              $3::timestamptz + schedule.period_index * INTERVAL '1 month'
       FROM unnest($4::text[]) WITH ORDINALITY AS ids(id, ordinal)
       JOIN LATERAL (SELECT (ids.ordinal - 1)::int AS period_index) schedule ON true`,
      [order.id, quote.credits, order.created_at, scheduleIds],
    );
    return order;
  });
}

export async function savePaymentCheckout(input: {
  orderId: string;
  providerId: string;
  providerPaymentId: string;
  paymentUrl: string;
}): Promise<PaymentOrderRow> {
  return transaction(async client => {
    const { rows } = await client.query<PaymentOrderRow>(
      `SELECT * FROM meduha_payment_orders WHERE id=$1 AND provider_id=$2 FOR UPDATE`,
      [input.orderId, input.providerId],
    );
    const order = rows[0];
    if (!order) throw new Error('PAYMENT_ORDER_NOT_FOUND');
    if (order.provider_payment_id && order.provider_payment_id !== input.providerPaymentId) {
      throw new Error('PROVIDER_PAYMENT_CONFLICT');
    }
    const updated = await client.query<PaymentOrderRow>(
      `UPDATE meduha_payment_orders
       SET provider_payment_id=$2, payment_url=$3, status='pending', updated_at=now()
       WHERE id=$1 AND status <> 'succeeded'
       RETURNING *`,
      [input.orderId, input.providerPaymentId, input.paymentUrl],
    );
    return updated.rows[0] ?? order;
  });
}

export async function markVerifiedPayment(
  providerId: string,
  payment: VerifiedProviderPayment,
): Promise<PaymentOrderRow | null> {
  if (!payment.orderId) return null;
  return transaction(async client => {
    const { rows } = await client.query<PaymentOrderRow>(
      `SELECT * FROM meduha_payment_orders WHERE id=$1 FOR UPDATE`,
      [payment.orderId],
    );
    const order = rows[0];
    if (!order) return null;
    if (order.provider_id !== providerId
      || order.amount_minor !== payment.amountMinor
      || order.currency !== payment.currency
      || (order.provider_payment_id && order.provider_payment_id !== payment.id)) {
      throw new Error('PAYMENT_DETAILS_MISMATCH');
    }

    const nextStatus = order.status === 'succeeded' ? 'succeeded'
      : payment.status === 'succeeded' ? 'succeeded'
        : payment.status === 'canceled' ? 'canceled' : order.status;
    const { rows: updated } = await client.query<PaymentOrderRow>(
      `UPDATE meduha_payment_orders
       SET status=$2, provider_payment_id=$3,
           paid_at=CASE WHEN $2='succeeded' THEN COALESCE(paid_at, now()) ELSE paid_at END,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [order.id, nextStatus, payment.id],
    );
    return updated[0] ?? null;
  });
}

export async function findPaymentOrderByProviderPaymentId(providerId: string, providerPaymentId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM meduha_payment_orders
     WHERE provider_id=$1 AND provider_payment_id=$2
     LIMIT 1`,
    [providerId, providerPaymentId],
  );
  return rows[0]?.id ?? null;
}

export async function getPaymentOrderForAccount(orderId: string, accountId: string) {
  const { rows } = await pool.query<PaymentOrderRow>(
    `SELECT * FROM meduha_payment_orders WHERE id=$1 AND account_id=$2`,
    [orderId, accountId],
  );
  const order = rows[0];
  if (!order) return null;
  const { rows: grants } = await pool.query<{ granted: string }>(
    `SELECT COUNT(*)::text AS granted FROM meduha_payment_installments
     WHERE order_id=$1 AND granted_at IS NOT NULL`,
    [order.id],
  );
  return { order, grantedMonths: Number(grants[0]?.granted ?? 0) };
}

/**
 * Processes one due installment. Row locking plus the ledger's globally unique
 * idempotency key make concurrent workers and repeated provider notifications safe.
 */
export async function grantNextDueInstallment(now = new Date()): Promise<boolean> {
  return transaction(async client => {
    const { rows } = await client.query<{
      id: string;
      order_id: string;
      period_index: number;
      credits: number;
      account_id: string;
      provider_id: string;
    }>(
      `SELECT i.id, i.order_id, i.period_index, i.credits, p.account_id, p.provider_id
       FROM meduha_payment_installments i
       JOIN meduha_payment_orders p ON p.id=i.order_id
       WHERE p.status='succeeded' AND i.granted_at IS NULL AND i.due_at <= $1
       ORDER BY i.due_at, i.order_id, i.period_index
       FOR UPDATE OF i SKIP LOCKED
       LIMIT 1`,
      [now],
    );
    const installment = rows[0];
    if (!installment) return false;

    const { rows: accountRows } = await client.query<{ credits: number }>(
      `SELECT credits FROM meduha_accounts WHERE id=$1 FOR UPDATE`,
      [installment.account_id],
    );
    if (!accountRows[0]) throw new Error('PAYMENT_ACCOUNT_NOT_FOUND');
    const previousBalance = Number(accountRows[0].credits);
    const nextBalance = previousBalance + installment.credits;
    if (!Number.isSafeInteger(nextBalance) || nextBalance > 2_147_483_647) {
      throw new Error('PAYMENT_CREDIT_BALANCE_LIMIT');
    }

    const ledgerId = randomUUID();
    const idempotencyKey = `payment:${installment.order_id}:month:${installment.period_index + 1}`;
    const { rows: ledgerRows } = await client.query<{ id: string; account_id: string; delta: number }>(
      `INSERT INTO meduha_finance_ledger
        (id, account_id, actor_id, kind, delta, reserved_delta, budget_delta,
         budget_day, reservation_id, reason, idempotency_key)
       VALUES ($1,$2,$3,'topup',$4,0,0,NULL,NULL,$5,$6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, account_id, delta`,
      [ledgerId, installment.account_id, `payment:${installment.provider_id}`, installment.credits,
        `Кредиты по предоплаченному тарифу · месяц ${installment.period_index + 1}`, idempotencyKey],
    );
    let ledgerEntry = ledgerRows[0];
    if (ledgerEntry) {
      await client.query('UPDATE meduha_accounts SET credits=$2, updated_at=now() WHERE id=$1', [
        installment.account_id, nextBalance,
      ]);
    } else {
      const prior = await client.query<{ id: string; account_id: string; delta: number; kind: string }>(
        `SELECT id, account_id, delta, kind FROM meduha_finance_ledger WHERE idempotency_key=$1`,
        [idempotencyKey],
      );
      const existing = prior.rows[0];
      if (!existing || existing.account_id !== installment.account_id
        || Number(existing.delta) !== installment.credits || existing.kind !== 'topup') {
        throw new Error('PAYMENT_LEDGER_IDEMPOTENCY_CONFLICT');
      }
      ledgerEntry = existing;
    }

    await client.query(
      `UPDATE meduha_payment_installments SET granted_at=COALESCE(granted_at,$2), ledger_id=$3 WHERE id=$1`,
      [installment.id, now, ledgerEntry.id],
    );
    return true;
  });
}
