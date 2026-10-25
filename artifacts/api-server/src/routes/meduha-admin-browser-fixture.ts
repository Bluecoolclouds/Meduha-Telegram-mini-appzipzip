import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';
import { temporaryAdminConfig } from '../lib/temporary-admin';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startMeduhaAdminBrowserFixture(options: { includeTestAccount?: boolean } = {}) {
  try {
    await Promise.all([
      pool.query('SELECT 1 FROM meduha_admin_login_attempts LIMIT 0'),
      pool.query('SELECT 1 FROM meduha_admin_sessions LIMIT 0'),
      pool.query('SELECT 1 FROM meduha_admin_audit LIMIT 0'),
    ]);
  } catch (error) {
    throw new Error(
      'The development database is missing admin authentication tables. Sync the project schema before running this browser test.',
      { cause: error },
    );
  }

  const fixtureEnv = {
    MEDUHA_ADMIN_LOGIN: 'admin',
    MEDUHA_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
    SESSION_SECRET: randomUUID(),
  };
  let config = temporaryAdminConfig(fixtureEnv);
  if (!config) throw new Error('Random browser-test credentials were not accepted.');

  const ip = `${randomInt(1, 224)}.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const rateKey = `password:${hash(ip)}`;
  const sessionHashes = new Set<string>();
  const [{ rows: ownerBefore }, { rows: financeBefore }] = await Promise.all([
    pool.query('SELECT * FROM meduha_template_admin WHERE slot = 1'),
    pool.query('SELECT * FROM meduha_finance_settings WHERE id = 1'),
  ]);

  let testAccount: { id: string; firstName: string; dailyLimit: number } | undefined;
  const financeMarker = `admin-browser-fixture:${randomUUID()}`;
  if (options.includeTestAccount) {
    try {
      await Promise.all([
        pool.query('SELECT 1 FROM meduha_accounts LIMIT 0'),
        pool.query('SELECT 1 FROM meduha_finance_ledger LIMIT 0'),
        pool.query('SELECT 1 FROM meduha_credit_reservations LIMIT 0'),
        pool.query('SELECT 1 FROM meduha_finance_idempotency LIMIT 0'),
      ]);
    } catch (error) {
      throw new Error('The development database is missing finance tables required by the account daily-usage browser test.', { cause: error });
    }

    const id = String(4_503_599_002_000_000 + randomInt(1_000_000));
    const firstName = `Daily usage fixture ${randomUUID()}`;
    const dailyLimit = 20;
    await pool.query(
      'INSERT INTO meduha_accounts (id, first_name, credits) VALUES ($1, $2, $3)',
      [id, firstName, 100],
    );
    try {
      if (financeBefore[0]) {
        await pool.query(
          `UPDATE meduha_finance_settings SET spending_enabled = true, daily_credit_limit = 1000000,
            per_account_daily_credit_limit = $1, max_active_reservations = 100,
            updated_at = clock_timestamp(), updated_by = $2 WHERE id = 1`,
          [dailyLimit, financeMarker],
        );
      } else {
        await pool.query(
          `INSERT INTO meduha_finance_settings
            (id, spending_enabled, daily_credit_limit, per_account_daily_credit_limit, max_active_reservations, updated_by)
           VALUES (1, true, 1000000, $1, 100, $2)`,
          [dailyLimit, financeMarker],
        );
      }
    } catch (error) {
      await pool.query('DELETE FROM meduha_accounts WHERE id = $1', [id]);
      throw error;
    }
    testAccount = { id, firstName, dailyLimit };
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/meduha', (req, _res, next) => {
    // Isolate this suite's shared login-attempt bucket from local and other test traffic.
    req.headers['x-forwarded-for'] = ip;
    next();
  });
  app.use('/api/meduha', (req, res, next) => {
    res.once('finish', () => {
      const header = res.getHeader('set-cookie');
      const cookies = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
      for (const value of cookies) {
        const match = /^meduha_admin_session=([a-f0-9]{64});/.exec(value);
        if (match) sessionHashes.add(hash(match[1]));
      }
    });
    next();
  });

  app.use('/api/meduha', createMeduhaRouter(
    () => undefined,
    async () => null,
    async () => false,
    true,
    fetch,
    undefined,
    {},
    undefined,
    () => config,
  ));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture API did not bind to a TCP port.');

  let stopped = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    credentials: { login: fixtureEnv.MEDUHA_ADMIN_LOGIN, password: fixtureEnv.MEDUHA_ADMIN_PASSWORD },
    testAccount,
    async stop() {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      try {
        await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id = ANY($1::text[])', [[...sessionHashes]]);
        await pool.query('DELETE FROM meduha_admin_sessions WHERE token_hash = ANY($1::text[])', [[...sessionHashes]]);
        await pool.query('DELETE FROM meduha_admin_login_attempts WHERE key = $1', [rateKey]);
        if (testAccount) {
          const accountIds = [testAccount.id];
          await pool.query(
            `DELETE FROM meduha_finance_idempotency WHERE ledger_id IN
              (SELECT id FROM meduha_finance_ledger WHERE account_id = ANY($1::text[]))`,
            [accountIds],
          );
          await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id = ANY($1::text[])', [accountIds]);
          await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = ANY($1::text[])', [accountIds]);
          await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id = ANY($1::text[])', [accountIds]);
          await pool.query('DELETE FROM meduha_accounts WHERE id = ANY($1::text[])', [accountIds]);
          if (financeBefore[0]) {
            const previous = financeBefore[0];
            const restored = await pool.query(
              `UPDATE meduha_finance_settings SET spending_enabled = $1, daily_credit_limit = $2,
                per_account_daily_credit_limit = $3, max_active_reservations = $4,
                updated_at = $5, updated_by = $6 WHERE id = 1 AND updated_by = $7`,
              [
                previous.spending_enabled, previous.daily_credit_limit, previous.per_account_daily_credit_limit,
                previous.max_active_reservations, previous.updated_at, previous.updated_by, financeMarker,
              ],
            );
            if (restored.rowCount !== 1) {
              throw new Error('Finance settings changed outside the daily-usage browser fixture and were not overwritten.');
            }
          } else {
            const removed = await pool.query(
              'DELETE FROM meduha_finance_settings WHERE id = 1 AND updated_by = $1',
              [financeMarker],
            );
            if (removed.rowCount !== 1) {
              throw new Error('Finance settings changed outside the daily-usage browser fixture and were not overwritten.');
            }
          }
        }
        config = null;

        const [{ rows: ownerAfter }, { rows: financeAfter }] = await Promise.all([
          pool.query('SELECT * FROM meduha_template_admin WHERE slot = 1'),
          pool.query('SELECT * FROM meduha_finance_settings WHERE id = 1'),
        ]);
        if (!isDeepStrictEqual(ownerAfter, ownerBefore)) {
          throw new Error('Browser auth fixture changed administrator ownership.');
        }
        if (!isDeepStrictEqual(financeAfter, financeBefore)) {
          throw new Error('Browser auth fixture changed financial settings.');
        }
      } catch (error) {
        throw new Error('Browser auth fixture cleanup or isolation check failed.', { cause: error });
      }
    },
  };
}
