import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { GetMeduhaWalletResponse } from '@workspace/api-zod';
import {
  adjustWallet,
  FinanceError,
  getFinanceSettings,
  getFinanceStats,
  getWallet,
  refundReservation,
  releaseReservation,
  reserveCredits,
  settleReservation,
  updateFinanceSettings,
} from './finance';

test('real PostgreSQL finance ledger, reservations, idempotency, budgets and rollback', async t => {
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const channelIds = [randomUUID(), randomUUID(), randomUUID()];
  const modelIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const keys = new Set<string>();
  const key = () => {
    const value = `finance-test-${randomUUID()}`;
    keys.add(value);
    return value;
  };
  const previousSettings = await getFinanceSettings();
  const insertAccount = async (id: string, credits: number) => {
    await pool.query(
      `INSERT INTO meduha_accounts (id, first_name, credits) VALUES ($1, 'Finance test fixture', $2)`,
      [id, credits],
    );
  };
  const insertChannel = async (id: string, enabled: boolean, concurrencyLimit: number, dailyCreditLimit: number) => {
    await pool.query(
      `INSERT INTO meduha_ai_channels
        (id, name, base_url, adapter, enabled, priority, concurrency_limit, daily_credit_limit)
       VALUES ($1, 'Finance test channel', 'https://invalid.example.test', 'test', $2, 0, $3, $4)`,
      [id, enabled, concurrencyLimit, dailyCreditLimit],
    );
  };
  const insertModel = async (
    id: string,
    channelId: string,
    enabled: boolean,
    limits: Record<string, number>,
  ) => {
    await pool.query(
      `INSERT INTO meduha_ai_models
        (id, channel_id, upstream_id, display_name, kind, enabled, credit_price, limits)
       VALUES ($1,$2,'finance-test-upstream','Finance test model','video',$3,10,$4::jsonb)`,
      [id, channelId, enabled, JSON.stringify(limits)],
    );
  };
  const codeIs = (code: string) => (error: unknown) => error instanceof FinanceError && error.code === code;

  try {
    await insertAccount(ids[0], 50);
    await insertAccount(ids[1], 100);
    await insertAccount(ids[2], 20);
    await insertAccount(ids[3], 100);
    await insertAccount(ids[4], 0);
    await insertChannel(channelIds[0], true, 1, 15);
    await insertChannel(channelIds[1], false, 5, 100);
    await insertChannel(channelIds[2], true, 10, 100);
    await insertModel(modelIds[0], channelIds[0], true, {});
    await insertModel(modelIds[1], channelIds[0], false, {});
    await insertModel(modelIds[2], channelIds[1], true, {});
    await insertModel(modelIds[3], channelIds[2], true, { concurrencyLimit: 1, dailyCreditLimit: 15 });
    await updateFinanceSettings({
      spendingEnabled: true,
      dailyCreditLimit: 1_000,
      perAccountDailyCreditLimit: 1_000,
      maxActiveReservations: 20,
    }, 'finance-test-admin');

    await t.test('parallel reservations cannot overspend a fixture account', async () => {
      const attempts = await Promise.allSettled([
        reserveCredits({
          accountId: ids[0], actorId: 'fixture-actor', amount: 35, reason: 'parallel test',
          idempotencyKey: key(),
        }),
        reserveCredits({
          accountId: ids[0], actorId: 'fixture-actor', amount: 35, reason: 'parallel test',
          idempotencyKey: key(),
        }),
      ]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = attempts.find(result => result.status === 'rejected');
      assert(rejected && rejected.status === 'rejected');
      assert(codeIs('INSUFFICIENT_CREDITS')(rejected.reason));
      const wallet = await getWallet(ids[0]);
      assert.equal(wallet.balance, 50);
      assert.equal(wallet.reserved, 35);
      assert.equal(wallet.available, 15);
      const held = wallet.reservations.find(item => item.status === 'held');
      assert(held);
      await releaseReservation({ reservationId: held.id, actorId: 'fixture-actor', idempotencyKey: key() });
      assert.equal((await getWallet(ids[0])).available, 50);
    });

    await t.test('account availability uses only that account holds while budget holds remain global', async () => {
      const holdA = await reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 50, reason: 'A full-balance hold',
        idempotencyKey: key(),
      });
      const holdB = await reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 40, reason: 'B independent hold',
        idempotencyKey: key(),
      });
      assert.equal((await getWallet(ids[0])).available, 0);
      assert.equal((await getWallet(ids[1])).available, 60);
      assert.equal(holdA.reservation?.status, 'held');
      assert.equal(holdB.reservation?.status, 'held');
      const releasedA = await releaseReservation({
        reservationId: holdA.reservation!.id, actorId: 'fixture-actor',
        idempotencyKey: key(), reason: 'A transition audit',
      });
      assert.equal(releasedA.ledgerEntry.reason, 'A transition audit');
      const releasedB = await releaseReservation({
        reservationId: holdB.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
      assert.equal(releasedB.ledgerEntry.reason, 'Manual reservation: B independent hold');
    });

    await t.test('model and channel state, price, daily and concurrency limits are enforced', async () => {
      const rejected = (code: string) => codeIs(code);
      await assert.rejects(reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'disabled model',
        idempotencyKey: key(), modelId: modelIds[1],
      }), rejected('SPENDING_DISABLED'));
      await assert.rejects(reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'disabled channel',
        idempotencyKey: key(), modelId: modelIds[2],
      }), rejected('SPENDING_DISABLED'));
      await assert.rejects(reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'wrong channel',
        idempotencyKey: key(), modelId: modelIds[0], channelId: channelIds[2],
      }), rejected('INVALID_INPUT'));
      await assert.rejects(reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 11, reason: 'wrong price',
        idempotencyKey: key(), modelId: modelIds[0],
      }), rejected('INVALID_INPUT'));

      const channelHold = await reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'channel concurrency',
        idempotencyKey: key(), modelId: modelIds[0],
      });
      await assert.rejects(reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 10, reason: 'channel cross-account concurrency',
        idempotencyKey: key(), modelId: modelIds[0],
      }), rejected('ACTIVE_RESERVATION_LIMIT'));
      await releaseReservation({
        reservationId: channelHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
      const channelDailyHold = await reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'channel daily budget',
        idempotencyKey: key(), modelId: modelIds[0],
      });
      await settleReservation({
        reservationId: channelDailyHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
      await assert.rejects(reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 10, reason: 'channel daily cross-account gate',
        idempotencyKey: key(), modelId: modelIds[0],
      }), rejected('DAILY_LIMIT_EXCEEDED'));
      await refundReservation({
        reservationId: channelDailyHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });

      const modelHold = await reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'model concurrency',
        idempotencyKey: key(), modelId: modelIds[3],
      });
      await assert.rejects(reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 10, reason: 'model cross-account concurrency',
        idempotencyKey: key(), modelId: modelIds[3],
      }), rejected('ACTIVE_RESERVATION_LIMIT'));
      await releaseReservation({
        reservationId: modelHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
      const modelDailyHold = await reserveCredits({
        accountId: ids[0], actorId: 'fixture-actor', amount: 10, reason: 'model daily budget',
        idempotencyKey: key(), modelId: modelIds[3],
      });
      await settleReservation({
        reservationId: modelDailyHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
      await assert.rejects(reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 10, reason: 'model daily cross-account gate',
        idempotencyKey: key(), modelId: modelIds[3],
      }), rejected('DAILY_LIMIT_EXCEEDED'));
      await refundReservation({
        reservationId: modelDailyHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
    });

    await t.test('idempotency replays identical inputs and rejects payload changes', async () => {
      const idempotencyKey = key();
      const first = await adjustWallet({
        accountId: ids[2], actorId: 'fixture-admin', delta: 5,
        reason: 'fixture opening adjustment', idempotencyKey,
      });
      const replay = await adjustWallet({
        accountId: ids[2], actorId: 'fixture-admin', delta: 5,
        reason: 'fixture opening adjustment', idempotencyKey,
      });
      assert.equal(first.wallet.balance, 25);
      assert.equal(replay.replayed, true);
      assert.equal(replay.ledgerEntry.id, first.ledgerEntry.id);
      await assert.rejects(
        adjustWallet({
          accountId: ids[2], actorId: 'fixture-admin', delta: 6,
          reason: 'fixture opening adjustment', idempotencyKey,
        }),
        codeIs('IDEMPOTENCY_CONFLICT'),
      );
      assert.equal((await getWallet(ids[2])).balance, 25);

      const reservationKey = key();
      const reserved = await reserveCredits({
        accountId: ids[2], actorId: 'fixture-actor', amount: 1,
        reason: 'idempotent hold', idempotencyKey: reservationKey,
      });
      const repeatedReservation = await reserveCredits({
        accountId: ids[2], actorId: 'fixture-actor', amount: 1,
        reason: 'idempotent hold', idempotencyKey: reservationKey,
      });
      assert.equal(repeatedReservation.replayed, true);
      assert.equal(repeatedReservation.reservation?.id, reserved.reservation?.id);
      await assert.rejects(
        reserveCredits({
          accountId: ids[2], actorId: 'fixture-actor', amount: 2,
          reason: 'idempotent hold', idempotencyKey: reservationKey,
        }),
        codeIs('IDEMPOTENCY_CONFLICT'),
      );
      await releaseReservation({
        reservationId: reserved.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key(),
      });
    });

    await t.test('held, settled, released and refunded state transitions are protected', async () => {
      const held = await reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 12, reason: 'release path',
        idempotencyKey: key(),
      });
      assert.equal(held.reservation?.status, 'held');
      const releaseKey = key();
      const released = await releaseReservation({
        reservationId: held.reservation!.id, actorId: 'fixture-actor', idempotencyKey: releaseKey,
        reason: 'release transition reason',
      });
      assert.equal(released.reservation?.status, 'released');
      assert.equal(released.ledgerEntry.reason, 'release transition reason');
      assert.equal((await releaseReservation({
        reservationId: held.reservation!.id, actorId: 'fixture-actor', idempotencyKey: releaseKey,
        reason: 'release transition reason',
      })).replayed, true);
      await assert.rejects(
        releaseReservation({
          reservationId: held.reservation!.id, actorId: 'fixture-actor', idempotencyKey: releaseKey,
          reason: 'different transition reason',
        }),
        codeIs('IDEMPOTENCY_CONFLICT'),
      );
      await assert.rejects(
        releaseReservation({ reservationId: held.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() }),
        codeIs('INVALID_RESERVATION_STATE'),
      );
      await assert.rejects(
        settleReservation({ reservationId: held.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() }),
        codeIs('INVALID_RESERVATION_STATE'),
      );

      const settlementHold = await reserveCredits({
        accountId: ids[1], actorId: 'fixture-actor', amount: 15, reason: 'settlement path',
        idempotencyKey: key(),
      });
      const settlementKey = key();
      const settled = await settleReservation({
        reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: settlementKey,
        reason: 'settlement transition reason',
      });
      assert.equal(settled.reservation?.status, 'settled');
      assert.equal(settled.ledgerEntry.reason, 'settlement transition reason');
      assert.equal(typeof settled.ledgerEntry.budgetDay, 'string');
      assert.match(settled.ledgerEntry.budgetDay!, /^\d{4}-\d{2}-\d{2}$/);
      assert.doesNotThrow(() => GetMeduhaWalletResponse.parse(JSON.parse(JSON.stringify(settled.wallet))));
      assert.equal(settled.wallet.balance, 85);
      const settlementReplay = await settleReservation({
        reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: settlementKey,
        reason: 'settlement transition reason',
      });
      assert.equal(settlementReplay.replayed, true);
      assert.equal(typeof settlementReplay.ledgerEntry.budgetDay, 'string');
      assert.match(settlementReplay.ledgerEntry.budgetDay!, /^\d{4}-\d{2}-\d{2}$/);
      await assert.rejects(
        settleReservation({ reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() }),
        codeIs('INVALID_RESERVATION_STATE'),
      );
      const refundKey = key();
      const refunded = await refundReservation({
        reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: refundKey,
        reason: 'refund transition reason',
      });
      assert.equal(refunded.reservation?.status, 'refunded');
      assert.equal(refunded.ledgerEntry.reason, 'refund transition reason');
      assert.equal(typeof refunded.ledgerEntry.budgetDay, 'string');
      assert.match(refunded.ledgerEntry.budgetDay!, /^\d{4}-\d{2}-\d{2}$/);
      assert.doesNotThrow(() => GetMeduhaWalletResponse.parse(JSON.parse(JSON.stringify(refunded.wallet))));
      assert.equal(refunded.wallet.balance, 100);
      assert.equal((await refundReservation({
        reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: refundKey,
        reason: 'refund transition reason',
      })).replayed, true);
      await assert.rejects(
        refundReservation({ reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() }),
        codeIs('INVALID_RESERVATION_STATE'),
      );
      await assert.rejects(
        releaseReservation({ reservationId: settlementHold.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() }),
        codeIs('INVALID_RESERVATION_STATE'),
      );
    });

    await t.test('global daily budget and active reservation gates include holds and settlements', async () => {
      await updateFinanceSettings({
        spendingEnabled: true, dailyCreditLimit: 25, maxActiveReservations: 1,
      }, 'finance-test-admin');
      const first = await reserveCredits({
        accountId: ids[3], actorId: 'fixture-actor', amount: 20, reason: 'budget hold',
        idempotencyKey: key(),
      });
      await assert.rejects(
        reserveCredits({
          accountId: ids[1], actorId: 'fixture-actor', amount: 1, reason: 'active gate',
          idempotencyKey: key(),
        }),
        codeIs('ACTIVE_RESERVATION_LIMIT'),
      );
      await releaseReservation({ reservationId: first.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() });
      const second = await reserveCredits({
        accountId: ids[3], actorId: 'fixture-actor', amount: 20, reason: 'budget settlement',
        idempotencyKey: key(),
      });
      await settleReservation({ reservationId: second.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() });
      assert.equal((await getFinanceStats()).dailyBudgetUsed, 20);
      await assert.rejects(
        reserveCredits({
          accountId: ids[1], actorId: 'fixture-actor', amount: 10, reason: 'settled budget gate',
          idempotencyKey: key(),
        }),
        codeIs('DAILY_LIMIT_EXCEEDED'),
      );
      await refundReservation({ reservationId: second.reservation!.id, actorId: 'fixture-actor', idempotencyKey: key() });
      assert.equal((await getFinanceStats()).dailyBudgetUsed, 0);
    });

    await t.test('transaction rollback leaves no changed balance or idempotency acknowledgement', async () => {
      const idempotencyKey = key();
      await pool.query(
        `INSERT INTO meduha_finance_ledger
          (id, account_id, actor_id, kind, delta, reserved_delta, budget_delta, reason, idempotency_key)
         VALUES ($1,$2,'fixture-actor','adjustment',1,0,0,'rollback collision',$3)`,
        [randomUUID(), ids[2], idempotencyKey],
      );
      const before = await getWallet(ids[2]);
      await assert.rejects(adjustWallet({
        accountId: ids[2], actorId: 'fixture-admin', delta: 7,
        reason: 'must roll back', idempotencyKey,
      }));
      const after = await getWallet(ids[2]);
      assert.equal(after.balance, before.balance);
      assert.equal(after.ledger.length, before.ledger.length);
      const { rows } = await pool.query(
        'SELECT 1 FROM meduha_finance_idempotency WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      assert.equal(rows.length, 0);
    });

    await t.test('kill switch and empty wallet retain explicit zero states', async () => {
      await updateFinanceSettings({ spendingEnabled: false }, 'finance-test-admin');
      const empty = await getWallet(ids[4]);
      assert.equal(empty.balance, 0);
      assert.equal(empty.reserved, 0);
      assert.equal(empty.available, 0);
      assert.deepEqual(empty.ledger, []);
      assert.deepEqual(empty.reservations, []);
      await assert.rejects(
        reserveCredits({
          accountId: ids[4], actorId: 'fixture-actor', amount: 1, reason: 'disabled gate',
          idempotencyKey: key(),
        }),
        codeIs('SPENDING_DISABLED'),
      );
    });
  } finally {
    await updateFinanceSettings({
      spendingEnabled: previousSettings.spendingEnabled,
      dailyCreditLimit: previousSettings.dailyCreditLimit,
      perAccountDailyCreditLimit: previousSettings.perAccountDailyCreditLimit,
      maxActiveReservations: previousSettings.maxActiveReservations,
    }, 'finance-test-cleanup');
    await pool.query(
      `UPDATE meduha_finance_settings SET updated_at=$1, updated_by=$2
       WHERE id=1 AND updated_by='finance-test-cleanup'`,
      [previousSettings.updatedAt, previousSettings.updatedBy],
    );
    const { rows: ledgerRows } = await pool.query(
      'SELECT id FROM meduha_finance_ledger WHERE account_id = ANY($1::text[])',
      [ids],
    );
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE idempotency_key = ANY($1::text[])', [[...keys]]);
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE ledger_id = ANY($1::text[])', [ledgerRows.map(row => row.id)]);
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id = ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM meduha_accounts WHERE id = ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM meduha_ai_models WHERE id = ANY($1::text[])', [modelIds]);
    await pool.query('DELETE FROM meduha_ai_channels WHERE id = ANY($1::text[])', [channelIds]);
  }
});
