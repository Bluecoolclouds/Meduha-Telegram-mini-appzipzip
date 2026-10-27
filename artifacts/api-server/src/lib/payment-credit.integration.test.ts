import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import {
  createPendingPaymentOrder,
  grantNextDueInstallment,
  markVerifiedPayment,
  savePaymentCheckout,
} from './billing-orders';
import { getBillingPlans, resolveBillingPlan } from './billing-pricing';
import type { VerifiedProviderPayment } from './payment-providers';
import { createFreeKassaProvider } from './freekassa';

type WorkerOperation = { type: 'grant-due'; now: string };

async function runWorker(schema: string, now: string): Promise<boolean[]> {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  databaseUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const operations = Array.from({ length: 100 }, (): WorkerOperation => ({ type: 'grant-due', now }));
  const child = spawn(process.execPath, [process.argv[1], JSON.stringify(operations)], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      PAYMENT_CREDIT_TEST_WORKER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, `payment worker failed; stderr: ${stderr}`);
  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`payment worker returned invalid JSON; stdout: ${stdout}; stderr: ${stderr}`);
  }
}

async function executeWorker(): Promise<void> {
  const operations: WorkerOperation[] = JSON.parse(process.argv[2] ?? '[]');
  const outcomes: boolean[] = [];
  for (const operation of operations) {
    outcomes.push(await grantNextDueInstallment(new Date(operation.now)));
  }
  await pool.end();
  process.stdout.write(JSON.stringify(outcomes));
}

if (process.env.PAYMENT_CREDIT_TEST_WORKER === '1') {
  void executeWorker().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  test('payment settlement and monthly grants are safe across repeated callbacks and workers', async t => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing payment integration tests against a production environment');
    }
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for isolated payment integration tests');
    }

    const schema = `payment_test_${randomUUID().replaceAll('-', '')}`;
    const schemaName = `"${schema}"`;
    const accountIds = Array.from({ length: 3 }, () => randomUUID());
    const poolWithMutableConnect = pool as any;
    const originalConnect = poolWithMutableConnect.connect.bind(pool);
    const setup = async () => {
      await pool.query(`CREATE SCHEMA ${schemaName}`);
      await pool.query(`
        CREATE TABLE ${schemaName}.meduha_accounts (
          id text PRIMARY KEY,
          credits integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schemaName}.meduha_finance_ledger (
          id text PRIMARY KEY,
          account_id text NOT NULL REFERENCES ${schemaName}.meduha_accounts(id),
          actor_id text NOT NULL,
          kind text NOT NULL,
          delta integer NOT NULL DEFAULT 0,
          reserved_delta integer NOT NULL DEFAULT 0,
          budget_delta integer NOT NULL DEFAULT 0,
          budget_day date,
          reservation_id text,
          reason text NOT NULL,
          idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schemaName}.meduha_payment_orders (
          id text PRIMARY KEY,
          account_id text NOT NULL REFERENCES ${schemaName}.meduha_accounts(id),
          provider_id text NOT NULL,
          provider_payment_id text,
          idempotency_key text NOT NULL,
          package_id text NOT NULL,
          term_months integer NOT NULL CHECK (term_months IN (1,3,12)),
          monthly_credits integer NOT NULL CHECK (monthly_credits > 0),
          amount_minor integer NOT NULL CHECK (amount_minor > 0),
          currency text NOT NULL CHECK (length(currency)=3),
          payment_url text,
          status text NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','succeeded','canceled','failed')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          paid_at timestamptz,
          UNIQUE (account_id, idempotency_key),
          UNIQUE (provider_id, provider_payment_id)
        );
        CREATE TABLE ${schemaName}.meduha_payment_installments (
          id text PRIMARY KEY,
          order_id text NOT NULL REFERENCES ${schemaName}.meduha_payment_orders(id) ON DELETE CASCADE,
          period_index integer NOT NULL CHECK (period_index >= 0),
          credits integer NOT NULL CHECK (credits > 0),
          due_at timestamptz NOT NULL,
          granted_at timestamptz,
          ledger_id text REFERENCES ${schemaName}.meduha_finance_ledger(id),
          UNIQUE (order_id, period_index)
        );
      `);
      await pool.query(
        `INSERT INTO ${schemaName}.meduha_accounts (id, credits) VALUES ($1,0),($2,0),($3,0)`,
        accountIds,
      );
      poolWithMutableConnect.connect = (...args: any[]) => {
        if (typeof args[0] === 'function') {
          const callback = args[0];
          return originalConnect((error: unknown, client: any, release: (error?: Error) => void) => {
            if (error || !client) {
              callback(error, client, release);
              return;
            }
            client.query(`SET search_path TO ${schemaName}`, (setError: Error | null) => {
              if (setError) {
                release(setError);
                callback(setError, undefined, undefined);
              } else {
                callback(null, client, release);
              }
            });
          });
        }
        return originalConnect().then(async (client: any) => {
          await client.query(`SET search_path TO ${schemaName}`);
          return client;
        });
      };
    };
    const cleanup = async () => {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } finally {
        poolWithMutableConnect.connect = originalConnect;
        await pool.end();
      }
    };

    try {
      await setup();
      await t.test('1, 3 and 12 month orders snapshot the correct RUB amount and monthly schedule', async () => {
        for (const [index, months] of [1, 3, 12].entries()) {
          const accountId = accountIds[index];
          const plan = getBillingPlans()[index];
          const quote = resolveBillingPlan(plan.id, months);
          assert(quote);
          const order = await createPendingPaymentOrder({
            accountId,
            idempotencyKey: `payment-term-${months}-${randomUUID()}`,
            planId: plan.id,
            termMonths: months,
            providerId: 'yookassa',
          });
          assert.equal(order.amount_minor, quote.totalAmountMinor);
          assert.equal(order.currency, 'RUB');
          assert.equal(order.term_months, months);
          const { rows } = await pool.query(
            `SELECT period_index, credits, due_at FROM ${schemaName}.meduha_payment_installments
             WHERE order_id=$1 ORDER BY period_index`,
            [order.id],
          );
          assert.equal(rows.length, months);
          assert.deepEqual(rows.map(row => Number(row.period_index)), Array.from({ length: months }, (_, i) => i));
          assert(rows.every(row => Number(row.credits) === quote.credits));
          assert(rows.every(row => new Date(row.due_at).getTime() >= new Date(order.created_at).getTime()));
        }
      });

      await t.test('unknown, mismatched and unfinished payments never grant credits', async () => {
        const plan = resolveBillingPlan('p100-270', 3)!;
        const createOrder = async (accountId: string) => {
          const order = await createPendingPaymentOrder({
            accountId,
            idempotencyKey: `payment-invalid-${randomUUID()}`,
            planId: plan.id,
            termMonths: 3,
            providerId: 'yookassa',
          });
          const providerPaymentId = `provider-${randomUUID()}`;
          await savePaymentCheckout({
            orderId: order.id,
            providerId: 'yookassa',
            providerPaymentId,
            paymentUrl: 'https://yookassa.ru/checkout/test',
          });
          return { order, providerPaymentId };
        };
        const { order, providerPaymentId } = await createOrder(accountIds[0]);
        const { order: canceledOrder, providerPaymentId: canceledProviderId } = await createOrder(accountIds[1]);
        const payment = (overrides: Partial<VerifiedProviderPayment> = {}): VerifiedProviderPayment => ({
          id: providerPaymentId,
          status: 'succeeded',
          amountMinor: order.amount_minor,
          currency: 'RUB',
          orderId: order.id,
          ...overrides,
        });
        assert.equal(await markVerifiedPayment('yookassa', payment({ orderId: randomUUID() })), null);
        await assert.rejects(
          markVerifiedPayment('yookassa', payment({ amountMinor: order.amount_minor + 1 })),
          /PAYMENT_DETAILS_MISMATCH/,
        );
        await assert.rejects(
          markVerifiedPayment('yookassa', payment({ currency: 'USD' })),
          /PAYMENT_DETAILS_MISMATCH/,
        );
        const unfinished = await markVerifiedPayment('yookassa', payment({
          status: 'pending',
        }));
        assert.equal(unfinished?.status, 'pending');
        const canceled = await markVerifiedPayment('yookassa', {
          id: canceledProviderId,
          status: 'canceled',
          amountMinor: canceledOrder.amount_minor,
          currency: 'RUB',
          orderId: canceledOrder.id,
        });
        assert.equal(canceled?.status, 'canceled');
        assert.equal(await grantNextDueInstallment(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)), false);
        const { rows: accounts } = await pool.query(
          `SELECT id, credits FROM ${schemaName}.meduha_accounts WHERE id = ANY($1::text[])`,
          [[accountIds[0], accountIds[1]]],
        );
        assert(accounts.every(account => Number(account.credits) === 0));
      });

      await t.test('duplicate successful callbacks and parallel processes grant each month exactly once', async () => {
        const plan = resolveBillingPlan('p300-1200', 12)!;
        const order = await createPendingPaymentOrder({
          accountId: accountIds[2],
          idempotencyKey: `payment-parallel-${randomUUID()}`,
          planId: plan.id,
          termMonths: 12,
          providerId: 'yookassa',
        });
        const providerPaymentId = `provider-${randomUUID()}`;
        await savePaymentCheckout({
          orderId: order.id,
          providerId: 'yookassa',
          providerPaymentId,
          paymentUrl: 'https://yookassa.ru/checkout/test',
        });
        const verified: VerifiedProviderPayment = {
          id: providerPaymentId,
          status: 'succeeded',
          amountMinor: order.amount_minor,
          currency: 'RUB',
          orderId: order.id,
        };
        assert.equal((await markVerifiedPayment('yookassa', verified))?.status, 'succeeded');
        assert.equal((await markVerifiedPayment('yookassa', verified))?.status, 'succeeded');

        const now = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
        const workerOutcomes = await Promise.all([runWorker(schema, now), runWorker(schema, now)]);
        assert.equal(workerOutcomes.flat().filter(Boolean).length, 12);
        const { rows: installments } = await pool.query(
          `SELECT id, period_index, granted_at, ledger_id
           FROM ${schemaName}.meduha_payment_installments WHERE order_id=$1 ORDER BY period_index`,
          [order.id],
        );
        assert.equal(installments.length, 12);
        assert(installments.every(row => row.granted_at && row.ledger_id));
        const { rows: ledger } = await pool.query(
          `SELECT id, delta, idempotency_key FROM ${schemaName}.meduha_finance_ledger
           WHERE account_id=$1 ORDER BY idempotency_key`,
          [accountIds[2]],
        );
        assert.equal(ledger.length, 12);
        assert.equal(new Set(ledger.map(row => row.idempotency_key)).size, 12);
        assert.deepEqual(
          ledger.map(row => row.idempotency_key).sort(),
          Array.from({ length: 12 }, (_, i) => `payment:${order.id}:month:${i + 1}`).sort(),
        );
        assert.deepEqual(
          installments.map(row => row.ledger_id).sort(),
          ledger.map(row => row.id).sort(),
        );
        assert(ledger.every(row => Number(row.delta) === plan.credits));
        const { rows: account } = await pool.query(
          `SELECT credits FROM ${schemaName}.meduha_accounts WHERE id=$1`,
          [accountIds[2]],
        );
        assert.equal(Number(account[0].credits), plan.credits * 12);
        assert.equal(await grantNextDueInstallment(new Date(now)), false);
        const { rows: replayLedger } = await pool.query(
          `SELECT count(*)::int AS count FROM ${schemaName}.meduha_finance_ledger WHERE account_id=$1`,
          [accountIds[2]],
        );
        assert.equal(replayLedger[0].count, 12);
      });
      await t.test('FreeKassa signed SCI notifications settle RUB orders and grant each prepaid month once', async () => {
        const provider = createFreeKassaProvider({
          merchantId: '123', secretWord1: 'fixture-one', secretWord2: 'fixture-two',
        });
        const plan = resolveBillingPlan('p300-1200', 3)!;
        const order = await createPendingPaymentOrder({
          accountId: accountIds[0], idempotencyKey: `freekassa-${randomUUID()}`,
          planId: plan.id, termMonths: 3, providerId: 'freekassa',
        });
        const checkout = await provider.createPayment({
          orderId: order.id, amountMinor: order.amount_minor, currency: 'RUB',
          description: 'Fixture', returnUrl: 'https://example.test/wallet', idempotencyKey: order.id,
        });
        await savePaymentCheckout({
          orderId: order.id, providerId: 'freekassa',
          providerPaymentId: checkout.paymentId, paymentUrl: checkout.confirmationUrl,
        });
        const signed = (amount: string) => provider.verifyNotification({
          MERCHANT_ID: '123', AMOUNT: amount, MERCHANT_ORDER_ID: order.id, intid: '123456',
          SIGN: createHash('md5').update(`123:${amount}:fixture-two:${order.id}`).digest('hex'),
        });
        await assert.rejects(markVerifiedPayment('freekassa', signed('1.00')), /PAYMENT_DETAILS_MISMATCH/);
        await assert.rejects(markVerifiedPayment('yookassa', signed((order.amount_minor / 100).toFixed(2))),
          /PAYMENT_DETAILS_MISMATCH/);
        const verified = signed((order.amount_minor / 100).toFixed(2));
        const settled = await Promise.all(Array.from({ length: 5 }, () => markVerifiedPayment('freekassa', verified)));
        assert(settled.every(result => result?.status === 'succeeded'));
        const now = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
        const results = await Promise.all([runWorker(schema, now), runWorker(schema, now)]);
        assert.equal(results.flat().filter(Boolean).length, 3);
        await markVerifiedPayment('freekassa', verified);
        assert.equal(await grantNextDueInstallment(new Date(now)), false);
        const { rows } = await pool.query(
          `SELECT delta, actor_id FROM ${schemaName}.meduha_finance_ledger WHERE account_id=$1`, [accountIds[0]],
        );
        assert.equal(rows.length, 3);
        assert(rows.every(row => row.actor_id === 'payment:freekassa' && row.delta === plan.credits));
      });
    } finally {
      await cleanup();
    }
  });
}
