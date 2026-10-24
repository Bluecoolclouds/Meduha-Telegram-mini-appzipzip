import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';
import { temporaryAdminConfig } from '../lib/temporary-admin';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startMeduhaAdminBrowserFixture() {
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
