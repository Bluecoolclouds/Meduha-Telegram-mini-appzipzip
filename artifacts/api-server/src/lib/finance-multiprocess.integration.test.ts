import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pool } from '@workspace/db';
import {
  adjustWallet,
  refundReservation,
  releaseReservation,
  reserveCredits,
  settleReservation,
  getWallet,
  updateFinanceSettings,
  type ReserveCreditsInput,
} from './finance';

type WorkerOperation =
  | { type: 'reserve'; input: ReserveCreditsInput }
  | { type: 'settle' | 'release' | 'refund'; reservationId: string; actorId: string; idempotencyKey: string }
  | { type: 'wallet'; accountId: string }
  | { type: 'account-limit'; limit: number; actorId: string }
  | { type: 'lose-response'; input: ReserveCreditsInput };

async function runWorker(
  operations: WorkerOperation[],
  options: { schema: string; now?: string; exitAfterCommit?: boolean },
): Promise<{ status: 'ok' | 'error'; result?: any; code?: string; message?: string }[]> {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  databaseUrl.searchParams.set('options', `-csearch_path=${options.schema}`);
  const workerEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    FINANCE_MULTIPROCESS_WORKER: '1',
    ...(options.now ? { FINANCE_MULTIPROCESS_NOW: options.now } : {}),
  };
  const child = spawn(process.execPath, [process.argv[1], JSON.stringify(operations)], {
    env: workerEnv,
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

  if (options.exitAfterCommit) {
    assert.equal(exitCode, 74, `worker should exit after commit without a response; stderr: ${stderr}`);
    assert.equal(stdout, '');
    return [];
  }
  assert.equal(exitCode, 0, `finance worker failed; stderr: ${stderr}`);
  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`finance worker returned invalid JSON; stdout: ${stdout}; stderr: ${stderr}`);
  }
}

async function executeWorker(): Promise<void> {
  if (process.env.FINANCE_MULTIPROCESS_NOW) {
    mock.timers.enable({
      apis: ['Date'],
      now: Date.parse(process.env.FINANCE_MULTIPROCESS_NOW),
    });
  }
  const operations: WorkerOperation[] = JSON.parse(process.argv[2] ?? '[]');
  if (operations.length === 1 && operations[0].type === 'lose-response') {
    await reserveCredits(operations[0].input);
    process.exit(74);
  }
  const results = [];
  for (const operation of operations) {
    try {
      if (operation.type === 'reserve') {
        results.push({ status: 'ok', result: await reserveCredits(operation.input) });
      } else if (operation.type === 'settle') {
        results.push({ status: 'ok', result: await settleReservation(operation) });
      } else if (operation.type === 'release') {
        results.push({ status: 'ok', result: await releaseReservation(operation) });
      } else if (operation.type === 'refund') {
        results.push({ status: 'ok', result: await refundReservation(operation) });
      } else if (operation.type === 'wallet') {
        results.push({ status: 'ok', result: await getWallet(operation.accountId) });
      } else if (operation.type === 'account-limit') {
        results.push({
          status: 'ok',
          result: await updateFinanceSettings(
            { perAccountDailyCreditLimit: operation.limit },
            operation.actorId,
          ),
        });
      } else {
        results.push({ status: 'error', code: 'INVALID_WORKER_OPERATION' });
      }
    } catch (error: any) {
      results.push({ status: 'error', code: error?.code, message: error?.message });
    }
  }
  await pool.end();
  process.stdout.write(JSON.stringify(results));
}

if (process.env.FINANCE_MULTIPROCESS_WORKER === '1') {
  void executeWorker().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  test('isolated finance operations stay consistent across independent API processes', async t => {
    const schema = `finance_mp_${randomUUID().replaceAll('-', '')}`;
    const ids = {
      accounts: [
        randomUUID(), randomUUID(), randomUUID(), randomUUID(),
        randomUUID(), randomUUID(), randomUUID(), randomUUID(),
      ],
      channel: randomUUID(),
      model: randomUUID(),
    };
    const actorId = 'finance-multiprocess-test-actor';
    const key = () => `finance-multiprocess-${randomUUID()}`;
    const input = (
      accountId: string,
      idempotencyKey = key(),
      withModel = true,
    ): ReserveCreditsInput => ({
      accountId,
      actorId,
      amount: 10,
      reason: 'isolated multi-process finance test',
      idempotencyKey,
      ...(withModel ? { modelId: ids.model, channelId: ids.channel } : {}),
    });
    const setup = async () => {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(`
        CREATE TABLE "${schema}".meduha_accounts (
          id text PRIMARY KEY, first_name text NOT NULL, credits integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE "${schema}".meduha_ai_channels (
          id text PRIMARY KEY, name text NOT NULL, base_url text NOT NULL, adapter text NOT NULL,
          enabled boolean NOT NULL DEFAULT false, priority integer NOT NULL DEFAULT 0,
          concurrency_limit integer NOT NULL DEFAULT 1, daily_credit_limit integer NOT NULL DEFAULT 0
        );
        CREATE TABLE "${schema}".meduha_ai_models (
          id text PRIMARY KEY, channel_id text NOT NULL, upstream_id text NOT NULL, display_name text NOT NULL,
          kind text NOT NULL, enabled boolean NOT NULL DEFAULT false, credit_price integer NOT NULL DEFAULT 0,
          limits jsonb NOT NULL DEFAULT '{}'::jsonb, genjutsu_pricing jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        CREATE TABLE "${schema}".meduha_finance_settings (
          id integer PRIMARY KEY, spending_enabled boolean NOT NULL DEFAULT false,
          daily_credit_limit integer NOT NULL DEFAULT 0, max_active_reservations integer NOT NULL DEFAULT 3,
          per_account_daily_credit_limit integer NOT NULL DEFAULT 100,
          updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
        );
        CREATE TABLE "${schema}".meduha_credit_reservations (
          id text PRIMARY KEY, account_id text NOT NULL REFERENCES "${schema}".meduha_accounts(id),
          actor_id text NOT NULL, amount integer NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'held',
          model_id text, channel_id text, idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          settled_at timestamptz, released_at timestamptz, refunded_at timestamptz
        );
        CREATE INDEX finance_mp_held_status_idx ON "${schema}".meduha_credit_reservations(status);
        CREATE TABLE "${schema}".meduha_finance_ledger (
          id text PRIMARY KEY, account_id text NOT NULL REFERENCES "${schema}".meduha_accounts(id),
          actor_id text NOT NULL, kind text NOT NULL, delta integer NOT NULL DEFAULT 0,
          reserved_delta integer NOT NULL DEFAULT 0, budget_delta integer NOT NULL DEFAULT 0,
          budget_day date, reservation_id text, reason text NOT NULL, idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX finance_mp_ledger_budget_day_idx ON "${schema}".meduha_finance_ledger(budget_day);
        CREATE TABLE "${schema}".meduha_finance_idempotency (
          idempotency_key text PRIMARY KEY, operation text NOT NULL, payload jsonb NOT NULL,
          ledger_id text NOT NULL, reservation_id text, created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `INSERT INTO "${schema}".meduha_accounts (id, first_name, credits)
         VALUES ${ids.accounts.map((_, i) => `($${i * 2 + 1}, 'Isolated finance fixture', $${i * 2 + 2})`).join(',')}`,
        ids.accounts.flatMap(id => [id, 100]),
      );
      await pool.query(
        `INSERT INTO "${schema}".meduha_ai_channels
          (id, name, base_url, adapter, enabled, concurrency_limit, daily_credit_limit)
         VALUES ($1, 'Fixture channel', 'https://invalid.example.test', 'test', true, 10, 100)`,
        [ids.channel],
      );
      await pool.query(
        `INSERT INTO "${schema}".meduha_ai_models
          (id, channel_id, upstream_id, display_name, kind, enabled, credit_price, limits)
         VALUES ($1,$2,'fixture','Fixture model','video',true,10,'{"concurrencyLimit":10,"dailyCreditLimit":100}')`,
        [ids.model, ids.channel],
      );
      await pool.query(
        `INSERT INTO "${schema}".meduha_finance_settings (id, spending_enabled, daily_credit_limit, max_active_reservations)
         VALUES (1, true, 100, 20)`,
      );
    };
    const setLimits = async (settings: { spending?: boolean; globalDaily?: number; accountDaily?: number; active?: number; channelActive?: number; channelDaily?: number; modelActive?: number; modelDaily?: number }) => {
      await pool.query(
        `UPDATE "${schema}".meduha_finance_settings
         SET spending_enabled=COALESCE($1,spending_enabled), daily_credit_limit=COALESCE($2,daily_credit_limit),
             max_active_reservations=COALESCE($3,max_active_reservations),
             per_account_daily_credit_limit=COALESCE($4,per_account_daily_credit_limit) WHERE id=1`,
        [settings.spending ?? null, settings.globalDaily ?? null, settings.active ?? null, settings.accountDaily ?? null],
      );
      await pool.query(
        `UPDATE "${schema}".meduha_ai_channels
         SET concurrency_limit=COALESCE($2,concurrency_limit), daily_credit_limit=COALESCE($3,daily_credit_limit)
         WHERE id=$1`,
        [ids.channel, settings.channelActive ?? null, settings.channelDaily ?? null],
      );
      await pool.query(
        `UPDATE "${schema}".meduha_ai_models SET limits=$2::jsonb WHERE id=$1`,
        [ids.model, JSON.stringify({
          concurrencyLimit: settings.modelActive ?? 10,
          dailyCreditLimit: settings.modelDaily ?? 100,
        })],
      );
    };
    const mutate = async (type: 'settle' | 'release' | 'refund', reservationId: string) => {
      const [result] = await runWorker([{
        type, reservationId, actorId, idempotencyKey: key(),
      }], { schema });
      assert.equal(result.status, 'ok', JSON.stringify(result));
      return result.result;
    };
    const countLedger = async (idempotencyKey: string) => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS count FROM "${schema}".meduha_finance_ledger WHERE idempotency_key=$1`,
        [idempotencyKey],
      );
      return rows[0].count as number;
    };
    const cleanSchema = async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    };

    try {
      await setup();
      await t.test('same key submitted concurrently by different processes makes one hold and one ledger entry', async () => {
        const duplicateKey = key();
        const sameInput = input(ids.accounts[0], duplicateKey);
        const [left, right] = await Promise.all([
          runWorker([{ type: 'reserve', input: sameInput }], { schema }),
          runWorker([{ type: 'reserve', input: sameInput }], { schema }),
        ]);
        assert.equal(left[0].status, 'ok');
        assert.equal(right[0].status, 'ok');
        assert.deepEqual([left[0].result.replayed, right[0].result.replayed].sort(), [false, true]);
        assert.equal(left[0].result.ledgerEntry.id, right[0].result.ledgerEntry.id);
        assert.equal(left[0].result.reservation.id, right[0].result.reservation.id);
        assert.equal(await countLedger(duplicateKey), 1);
        assert.equal(left[0].result.wallet.balance, 100);
        assert.equal(left[0].result.wallet.reserved, 10);
        assert.equal(left[0].result.wallet.available, 90);
        await mutate('release', left[0].result.reservation.id);
      });

      await t.test('separate processes concurrently settle, release and refund different reservations', async () => {
        await setLimits({ globalDaily: 100, active: 20, channelActive: 10, modelActive: 10 });
        const holds = await Promise.all(ids.accounts.slice(0, 3).map((accountId, index) =>
          runWorker([{ type: 'reserve', input: input(accountId) }], { schema })
            .then(result => ({ index, result: result[0] })),
        ));
        for (const hold of holds) assert.equal(hold.result.status, 'ok', JSON.stringify(hold.result));

        const [settleSetup, releaseSetup, refundSetup] = holds.map(hold => hold.result.result.reservation.id);
        await mutate('settle', refundSetup);
        const transitions = await Promise.all([
          runWorker([{
            type: 'settle', reservationId: settleSetup, actorId, idempotencyKey: key(),
          }], { schema }),
          runWorker([{
            type: 'release', reservationId: releaseSetup, actorId, idempotencyKey: key(),
          }], { schema }),
          runWorker([{
            type: 'refund', reservationId: refundSetup, actorId, idempotencyKey: key(),
          }], { schema }),
        ]);
        assert(transitions.every(result => result[0].status === 'ok'), JSON.stringify(transitions));
        assert.equal(transitions[0][0].result.wallet.balance, 90);
        assert.equal(transitions[1][0].result.wallet.balance, 100);
        assert.equal(transitions[2][0].result.wallet.balance, 100);
        assert(transitions.every(result => result[0].result.wallet.reserved === 0));
      });

      await t.test('channel concurrency limit is shared across processes and accounts', async () => {
        await setLimits({ channelActive: 1, modelActive: 10 });
        const [first, second] = await Promise.all([
          runWorker([{ type: 'reserve', input: input(ids.accounts[0]) }], { schema }),
          runWorker([{ type: 'reserve', input: input(ids.accounts[1]) }], { schema }),
        ]);
        const outcomes = [first[0], second[0]];
        assert.equal(outcomes.filter(item => item.status === 'ok').length, 1);
        assert.equal(outcomes.filter(item => item.code === 'ACTIVE_RESERVATION_LIMIT').length, 1);
        const winner = outcomes.find(item => item.status === 'ok')!;
        await mutate('release', winner.result.reservation.id);
      });

      await t.test('model concurrency limit is shared across processes and accounts', async () => {
        await setLimits({ channelActive: 10, modelActive: 1 });
        const [first, second] = await Promise.all([
          runWorker([{ type: 'reserve', input: input(ids.accounts[0]) }], { schema }),
          runWorker([{ type: 'reserve', input: input(ids.accounts[1]) }], { schema }),
        ]);
        const outcomes = [first[0], second[0]];
        assert.equal(outcomes.filter(item => item.status === 'ok').length, 1);
        assert.equal(outcomes.filter(item => item.code === 'ACTIVE_RESERVATION_LIMIT').length, 1);
        const winner = outcomes.find(item => item.status === 'ok')!;
        await mutate('release', winner.result.reservation.id);
      });

      await t.test('global active and daily budgets include holds created by other processes', async () => {
        await setLimits({ channelActive: 10, modelActive: 10, active: 1, globalDaily: 100 });
        const activeAttempts = await Promise.all([
          runWorker([{ type: 'reserve', input: input(ids.accounts[0], key(), false) }], { schema }),
          runWorker([{ type: 'reserve', input: input(ids.accounts[1], key(), false) }], { schema }),
        ]);
        const activeOutcomes = activeAttempts.map(result => result[0]);
        assert.equal(activeOutcomes.filter(item => item.status === 'ok').length, 1);
        assert.equal(activeOutcomes.filter(item => item.code === 'ACTIVE_RESERVATION_LIMIT').length, 1);
        const activeWinner = activeOutcomes.find(item => item.status === 'ok')!;
        await mutate('release', activeWinner.result.reservation.id);

        await setLimits({ active: 10, globalDaily: 20 });
        const budgetAttempts = await Promise.all([
          runWorker([{ type: 'reserve', input: input(ids.accounts[0], key(), false) }], { schema }),
          runWorker([{ type: 'reserve', input: input(ids.accounts[1], key(), false) }], { schema }),
        ]);
        const budgetOutcomes = budgetAttempts.map(result => result[0]);
        assert.equal(budgetOutcomes.filter(item => item.status === 'ok').length, 1);
        assert.equal(budgetOutcomes.filter(item => item.code === 'DAILY_LIMIT_EXCEEDED').length, 1);
        const budgetWinner = budgetOutcomes.find(item => item.status === 'ok')!;
        await mutate('release', budgetWinner.result.reservation.id);
      });

      await t.test('channel and model daily budgets account for settlement and refund across processes', async () => {
        await setLimits({ globalDaily: 100, channelDaily: 20, modelDaily: 100 });
        const channelHold = await runWorker([{ type: 'reserve', input: input(ids.accounts[0]) }], { schema });
        assert.equal(channelHold[0].status, 'ok');
        const channelReservation = channelHold[0].result.reservation.id;
        await mutate('settle', channelReservation);
        const channelBlocked = await runWorker([{ type: 'reserve', input: input(ids.accounts[1]) }], { schema });
        assert.equal(channelBlocked[0].code, 'DAILY_LIMIT_EXCEEDED');
        await mutate('refund', channelReservation);

        await setLimits({ channelDaily: 100, modelDaily: 20 });
        const modelHold = await runWorker([{ type: 'reserve', input: input(ids.accounts[0]) }], { schema });
        assert.equal(modelHold[0].status, 'ok');
        const modelReservation = modelHold[0].result.reservation.id;
        await mutate('settle', modelReservation);
        const modelBlocked = await runWorker([{ type: 'reserve', input: input(ids.accounts[1]) }], { schema });
        assert.equal(modelBlocked[0].code, 'DAILY_LIMIT_EXCEEDED');
        const refund = await mutate('refund', modelReservation);
        assert.equal(refund.wallet.balance, 90);
        assert.equal(refund.wallet.reserved, 0);
        assert.equal(refund.wallet.available, 90);
      });

      await t.test('per-account limit serializes different processes, counts settlements once and isolates accounts', async () => {
        await setLimits({ globalDaily: 100, channelDaily: 100, modelDaily: 100, accountDaily: 20, active: 20 });
        // This account already spent 10 in the earlier transition test.
        const account = ids.accounts[0];
        const attempts = await Promise.all([
          runWorker([{ type: 'reserve', input: input(account, key(), false) }], { schema }),
          runWorker([{ type: 'reserve', input: input(account, key(), false) }], { schema }),
        ]);
        const outcomes = attempts.map(result => result[0]);
        assert.equal(outcomes.filter(result => result.status === 'ok').length, 1);
        assert.equal(outcomes.filter(result => result.code === 'DAILY_LIMIT_EXCEEDED').length, 1);
        const held = outcomes.find(result => result.status === 'ok')!.result.reservation.id;
        await mutate('settle', held);
        const blocked = await runWorker([{ type: 'reserve', input: input(account, key(), false) }], { schema });
        assert.equal(blocked[0].code, 'DAILY_LIMIT_EXCEEDED');
        assert.match(blocked[0].message!, /аккаунта/);
        const other = await runWorker([{ type: 'reserve', input: input(ids.accounts[1], key(), false) }], { schema });
        assert.equal(other[0].status, 'ok');
        await mutate('release', other[0].result.reservation.id);
        await mutate('refund', held);
        const restored = await runWorker([{ type: 'reserve', input: input(account, key(), false) }], { schema });
        assert.equal(restored[0].status, 'ok');
        await mutate('release', restored[0].result.reservation.id);

        await setLimits({ accountDaily: 0 });
        const zero = await runWorker([{ type: 'reserve', input: input(ids.accounts[1], key(), false) }], { schema });
        assert.equal(zero[0].code, 'DAILY_LIMIT_EXCEEDED');
        await setLimits({ accountDaily: 100 });
      });

      await t.test('wallet snapshots stay consistent while reservations and the per-account limit change', async () => {
        const day = '2026-10-25';
        const now = `${day}T12:00:00.000Z`;
        const account = ids.accounts[6];
        const otherAccount = ids.accounts[7];
        await setLimits({
          globalDaily: 100,
          accountDaily: 40,
          channelDaily: 100,
          modelDaily: 100,
          active: 20,
          channelActive: 10,
          modelActive: 10,
        });

        const [otherHold] = await runWorker([
          { type: 'reserve', input: input(otherAccount, key(), false) },
        ], { schema, now });
        assert.equal(otherHold.status, 'ok', JSON.stringify(otherHold));
        const [otherSettlement] = await runWorker([{
          type: 'settle',
          reservationId: otherHold.result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now });
        assert.equal(otherSettlement.status, 'ok', JSON.stringify(otherSettlement));

        const initialHolds = await Promise.all([account, account].map(accountId =>
          runWorker([{ type: 'reserve', input: input(accountId, key(), false) }], { schema, now }),
        ));
        assert(initialHolds.every(([result]) => result.status === 'ok'), JSON.stringify(initialHolds));
        const [settleId, releaseId] = initialHolds.map(([result]) => result.result.reservation.id);

        const verifySnapshot = (wallet: any) => {
          const { dailyUsage } = wallet;
          const heldFromSnapshot = wallet.reservations
            .filter((reservation: any) => reservation.status === 'held')
            .reduce((sum: number, reservation: any) => sum + reservation.amount, 0);
          const netSpentFromSnapshot = wallet.ledger
            .filter((entry: any) => entry.budgetDay === day)
            .reduce((sum: number, entry: any) => sum + entry.budgetDelta, 0);
          assert.equal(dailyUsage.activeReserves, wallet.reserved);
          assert.equal(dailyUsage.activeReserves, heldFromSnapshot);
          assert.equal(dailyUsage.netSpent, netSpentFromSnapshot);
          assert.equal(
            dailyUsage.remaining,
            Math.max(0, dailyUsage.perAccountDailyCreditLimit
              - Math.max(0, dailyUsage.activeReserves + dailyUsage.netSpent)),
          );
          assert.equal(wallet.balance, 100 - dailyUsage.netSpent);
          assert([30, 40, 50].includes(dailyUsage.perAccountDailyCreditLimit));
        };

        const concurrent = await Promise.all([
          runWorker(Array.from({ length: 8 }, () => ({ type: 'wallet' as const, accountId: account })), { schema, now }),
          runWorker(Array.from({ length: 8 }, () => ({ type: 'wallet' as const, accountId: account })), { schema, now }),
          runWorker([{
            type: 'settle', reservationId: settleId, actorId, idempotencyKey: key(),
          }], { schema, now }),
          runWorker([{
            type: 'release', reservationId: releaseId, actorId, idempotencyKey: key(),
          }], { schema, now }),
          runWorker([{ type: 'reserve', input: input(account, key(), false) }], { schema, now }),
          ...[30, 40, 50].map(limit => runWorker([{
            type: 'account-limit', limit, actorId,
          }], { schema, now })),
        ]);
        const readers = concurrent.slice(0, 2).flatMap(result => result);
        assert.equal(readers.length, 16);
        for (const read of readers) {
          assert.equal(read.status, 'ok', JSON.stringify(read));
          verifySnapshot(read.result);
        }
        for (const transition of concurrent.slice(2, 4)) {
          assert.equal(transition[0].status, 'ok', JSON.stringify(transition[0]));
        }
        const concurrentReserve = concurrent[4][0];
        assert.equal(concurrentReserve.status, 'ok', JSON.stringify(concurrentReserve));
        for (const settingUpdate of concurrent.slice(5)) {
          assert.equal(settingUpdate[0].status, 'ok', JSON.stringify(settingUpdate[0]));
        }
        const [extraSettlement] = await runWorker([{
          type: 'settle',
          reservationId: concurrentReserve.result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now });
        assert.equal(extraSettlement.status, 'ok', JSON.stringify(extraSettlement));

        const [accountWallet, otherWallet] = await Promise.all([
          runWorker([{ type: 'wallet', accountId: account }], { schema, now }),
          runWorker([{ type: 'wallet', accountId: otherAccount }], { schema, now }),
        ]);
        assert.equal(accountWallet[0].status, 'ok');
        assert.equal(otherWallet[0].status, 'ok');
        verifySnapshot(accountWallet[0].result);
        assert.equal(accountWallet[0].result.dailyUsage.activeReserves, 0);
        assert.equal(accountWallet[0].result.dailyUsage.netSpent, 20);
        assert.equal(accountWallet[0].result.dailyUsage.remaining,
          Math.max(0, accountWallet[0].result.dailyUsage.perAccountDailyCreditLimit - 20));
        assert.equal(otherWallet[0].result.dailyUsage.activeReserves, 0);
        assert.equal(otherWallet[0].result.dailyUsage.netSpent, 10);
        assert.equal(otherWallet[0].result.dailyUsage.remaining,
          Math.max(0, otherWallet[0].result.dailyUsage.perAccountDailyCreditLimit - 10));

        const { rows: beforeRead } = await pool.query(
          `SELECT credits FROM "${schema}".meduha_accounts WHERE id=$1`,
          [account],
        );
        const beforeBalance = Number(beforeRead[0].credits);
        const [readOnce, readAgain] = await Promise.all([
          runWorker([{ type: 'wallet', accountId: account }], { schema, now }),
          runWorker([{ type: 'wallet', accountId: account }], { schema, now }),
        ]);
        assert.equal(readOnce[0].result.balance, beforeBalance);
        assert.equal(readAgain[0].result.balance, beforeBalance);
        const { rows: afterRead } = await pool.query(
          `SELECT credits FROM "${schema}".meduha_accounts WHERE id=$1`,
          [account],
        );
        assert.equal(Number(afterRead[0].credits), beforeBalance, 'wallet reads must not mutate the balance');
      });

      await t.test('kill switch blocks new holds without changing the isolated wallet', async () => {
        await setLimits({ spending: false });
        const rejected = await runWorker([{ type: 'reserve', input: input(ids.accounts[0], key(), false) }], { schema });
        assert.equal(rejected[0].status, 'error');
        assert.equal(rejected[0].code, 'SPENDING_DISABLED');
        const { rows } = await pool.query(
          `SELECT credits FROM "${schema}".meduha_accounts WHERE id=$1`,
          [ids.accounts[0]],
        );
        assert.equal(Number(rows[0].credits), 90);
        await setLimits({ spending: true });
      });

      await t.test('lost post-commit response recovers by replay after process restart', async () => {
        const lostKey = key();
        const lostInput = input(ids.accounts[2], lostKey, false);
        await runWorker([{ type: 'lose-response', input: lostInput }], { schema, exitAfterCommit: true });
        const [recovered] = await runWorker([{ type: 'reserve', input: lostInput }], { schema });
        assert.equal(recovered.status, 'ok');
        assert.equal(recovered.result.replayed, true);
        assert.equal(recovered.result.wallet.balance, 100);
        assert.equal(recovered.result.wallet.reserved, 10);
        assert.equal(recovered.result.wallet.available, 90);
        assert.equal(await countLedger(lostKey), 1);
        await mutate('release', recovered.result.reservation.id);
      });

      await t.test('daily budgets reset exactly at midnight UTC across process restarts', async () => {
        await setLimits({ globalDaily: 100, accountDaily: 10, channelDaily: 100, modelDaily: 100 });
        const beforeMidnight = await runWorker([
          { type: 'reserve', input: input(ids.accounts[3], key(), false) },
        ], { schema, now: '2026-08-31T23:59:59.999Z' });
        assert.equal(beforeMidnight[0].status, 'ok', JSON.stringify(beforeMidnight[0]));
        const beforeSettlement = await runWorker([{
          type: 'settle',
          reservationId: beforeMidnight[0].result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now: '2026-08-31T23:59:59.999Z' });
        assert.equal(beforeSettlement[0].status, 'ok', JSON.stringify(beforeSettlement[0]));
        assert.equal(beforeSettlement[0].result.ledgerEntry.budgetDay, '2026-08-31');
        const exhausted = await runWorker([
          { type: 'reserve', input: input(ids.accounts[3], key(), false) },
        ], { schema, now: '2026-08-31T23:59:59.999Z' });
        assert.equal(exhausted[0].code, 'DAILY_LIMIT_EXCEEDED');

        const afterMidnight = await runWorker([
          { type: 'reserve', input: input(ids.accounts[3], key(), false) },
        ], { schema, now: '2026-09-01T00:00:00.001Z' });
        assert.equal(afterMidnight[0].status, 'ok', JSON.stringify(afterMidnight[0]));
        const afterSettlement = await runWorker([{
          type: 'settle',
          reservationId: afterMidnight[0].result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now: '2026-09-01T00:00:00.001Z' });
        assert.equal(afterSettlement[0].status, 'ok', JSON.stringify(afterSettlement[0]));
        assert.equal(afterSettlement[0].result.ledgerEntry.budgetDay, '2026-09-01');
        assert.equal(afterSettlement[0].result.wallet.balance, 80);

        const { rows } = await pool.query(
          `SELECT budget_day::text AS day, sum(budget_delta)::int AS used
           FROM "${schema}".meduha_finance_ledger
           WHERE kind='settlement' AND budget_day BETWEEN '2026-08-31'::date AND '2026-09-01'::date
           GROUP BY budget_day ORDER BY budget_day`,
        );
        assert.deepEqual(rows.map(row => [row.day, Number(row.used)]), [
          ['2026-08-31', 10],
          ['2026-09-01', 10],
        ]);
      });

      await t.test('refund of yesterday settlement restores balance without reopening today account budget', async () => {
        await setLimits({ globalDaily: 100, accountDaily: 10, channelDaily: 100, modelDaily: 100 });
        const account = ids.accounts[4];
        const yesterday = '2026-09-04';
        const today = '2026-09-05';
        const beforeMidnight = `${yesterday}T23:59:59.999Z`;
        const afterMidnight = `${today}T00:00:00.001Z`;

        const [yesterdayHold] = await runWorker([
          { type: 'reserve', input: input(account, key(), false) },
        ], { schema, now: beforeMidnight });
        assert.equal(yesterdayHold.status, 'ok', JSON.stringify(yesterdayHold));
        const [yesterdaySettlement] = await runWorker([{
          type: 'settle',
          reservationId: yesterdayHold.result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now: beforeMidnight });
        assert.equal(yesterdaySettlement.status, 'ok', JSON.stringify(yesterdaySettlement));
        assert.equal(yesterdaySettlement.result.ledgerEntry.budgetDay, yesterday);

        const [todayHold] = await runWorker([
          { type: 'reserve', input: input(account, key(), false) },
        ], { schema, now: afterMidnight });
        assert.equal(todayHold.status, 'ok', JSON.stringify(todayHold));
        const [todaySettlement] = await runWorker([{
          type: 'settle',
          reservationId: todayHold.result.reservation.id,
          actorId,
          idempotencyKey: key(),
        }], { schema, now: afterMidnight });
        assert.equal(todaySettlement.status, 'ok', JSON.stringify(todaySettlement));
        assert.equal(todaySettlement.result.ledgerEntry.budgetDay, today);
        assert.equal(todaySettlement.result.wallet.balance, 80);

        const refundKey = key();
        const refundOperation = {
          type: 'refund' as const,
          reservationId: yesterdayHold.result.reservation.id,
          actorId,
          idempotencyKey: refundKey,
        };
        const [refund] = await runWorker([refundOperation], { schema, now: afterMidnight });
        assert.equal(refund.status, 'ok', JSON.stringify(refund));
        assert.equal(refund.result.ledgerEntry.budgetDay, yesterday);
        assert.equal(refund.result.ledgerEntry.delta, 10);
        assert.equal(refund.result.ledgerEntry.budgetDelta, -10);
        assert.equal(refund.result.wallet.balance, 90);
        assert.equal(refund.result.wallet.reserved, 0);
        assert.equal(refund.result.wallet.available, 90);

        const [replayedRefund] = await runWorker([refundOperation], { schema, now: afterMidnight });
        assert.equal(replayedRefund.status, 'ok', JSON.stringify(replayedRefund));
        assert.equal(replayedRefund.result.replayed, true);
        assert.equal(replayedRefund.result.ledgerEntry.id, refund.result.ledgerEntry.id);
        assert.equal(replayedRefund.result.wallet.balance, 90);
        assert.equal(await countLedger(refundKey), 1);

        const blockedToday = await runWorker([
          { type: 'reserve', input: input(account, key(), false) },
        ], { schema, now: afterMidnight });
        assert.equal(blockedToday[0].code, 'DAILY_LIMIT_EXCEEDED');

        const { rows: budgetRows } = await pool.query(
          `SELECT budget_day::text AS day, sum(budget_delta)::int AS used
           FROM "${schema}".meduha_finance_ledger
           WHERE account_id=$1 AND budget_day BETWEEN $2::date AND $3::date
           GROUP BY budget_day ORDER BY budget_day`,
          [account, yesterday, today],
        );
        assert.deepEqual(budgetRows.map(row => [row.day, Number(row.used)]), [
          [yesterday, 0],
          [today, 10],
        ]);
      });

      await t.test('holds carry across UTC midnight and cap reductions only block new reservations', async () => {
        await setLimits({ accountDaily: 10, globalDaily: 100 });
        const account = ids.accounts[3];
        const [held] = await runWorker([{ type: 'reserve', input: input(account, key(), false) }],
          { schema, now: '2026-09-02T23:59:59.999Z' });
        assert.equal(held.status, 'ok');
        const [blocked] = await runWorker([{ type: 'reserve', input: input(account, key(), false) }],
          { schema, now: '2026-09-03T00:00:00.001Z' });
        assert.equal(blocked.code, 'DAILY_LIMIT_EXCEEDED');
        await setLimits({ accountDaily: 0 });
        const [settled] = await runWorker([{ type: 'settle', reservationId: held.result.reservation.id, actorId, idempotencyKey: key() }],
          { schema, now: '2026-09-03T00:00:00.001Z' });
        assert.equal(settled.status, 'ok');
        assert.equal(settled.result.ledgerEntry.budgetDay, '2026-09-03');
      });

      const { rows: finalAccounts } = await pool.query(
        `SELECT credits FROM "${schema}".meduha_accounts`,
      );
      assert(finalAccounts.every(row => Number(row.credits) >= 0), 'no fixture wallet may go negative');
      const { rows: duplicateLedgerRows } = await pool.query(
        `SELECT idempotency_key FROM "${schema}".meduha_finance_ledger GROUP BY idempotency_key HAVING count(*) > 1`,
      );
      assert.deepEqual(duplicateLedgerRows, [], 'one idempotency key must never create multiple ledger rows');
      const { rows: heldTotals } = await pool.query(
        `SELECT
           COALESCE((SELECT sum(amount) FROM "${schema}".meduha_credit_reservations WHERE status='held'),0)::int AS held,
           COALESCE((SELECT sum(reserved_delta) FROM "${schema}".meduha_finance_ledger),0)::int AS ledger_held`,
      );
      assert.equal(Number(heldTotals[0].held), Number(heldTotals[0].ledger_held));
    } finally {
      await cleanSchema();
    }
  });
}
