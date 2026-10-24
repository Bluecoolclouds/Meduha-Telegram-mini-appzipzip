import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';
import { PASSWORD_ATTEMPT_LIMIT, TEMPORARY_ADMIN_ACTOR, temporaryAdminConfig } from '../lib/temporary-admin';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('temporary configuration requires explicit admin login, password and session secret', () => {
  const password = randomBytes(32).toString('hex'), sessionSecret = randomUUID();
  const env = { MEDUHA_ADMIN_LOGIN: 'admin', MEDUHA_ADMIN_PASSWORD: password, SESSION_SECRET: sessionSecret };
  assert(temporaryAdminConfig(env));
  assert.equal(temporaryAdminConfig({}), null);
  assert.equal(temporaryAdminConfig({ ...env, MEDUHA_ADMIN_LOGIN: undefined }), null);
  assert.equal(temporaryAdminConfig({ ...env, MEDUHA_ADMIN_LOGIN: 'someone' }), null);
  assert.equal(temporaryAdminConfig({ ...env, MEDUHA_ADMIN_PASSWORD: '' }), null);
  assert.equal(temporaryAdminConfig({ ...env, SESSION_SECRET: undefined }), null);
  assert.notEqual(temporaryAdminConfig(env)?.fingerprint, temporaryAdminConfig({ ...env, SESSION_SECRET: randomUUID() })?.fingerprint);
});

test('password auth is isolated from Telegram, revocable, rate limited and audited', async () => {
  // Random fixture credentials only. Never read or replace the owner's secrets.
  const fixtureEnv = { MEDUHA_ADMIN_LOGIN: 'admin', MEDUHA_ADMIN_PASSWORD: randomBytes(32).toString('hex'), SESSION_SECRET: randomUUID() };
  let config = temporaryAdminConfig(fixtureEnv);
  const initialConfig = config;
  const ip = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
  const rateKey = `password:${hash(ip)}`;
  const userId = `fixture-password-${randomUUID()}`;
  const telegramId = String(4_503_599_003_000_000 + randomInt(1_000_000));
  const botToken = `${randomInt(100000, 999999)}:${randomBytes(24).toString('hex')}`;
  let telegramAdminEnabled = false;
  const adjustmentKey = `password-test-${randomUUID()}`;
  const sessionHashes: string[] = [];
  const { rows: ownerBefore } = await pool.query('SELECT * FROM meduha_template_admin WHERE slot = 1');
  const { rows: financeBefore } = await pool.query('SELECT * FROM meduha_finance_settings WHERE id = 1');
  const app = express();
  app.set('trust proxy', 1);
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/meduha', createMeduhaRouter(
    () => botToken, async () => null, async id => telegramAdminEnabled && id === telegramId,
    false, fetch, undefined, {}, undefined, () => config,
  ));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/meduha`;
  const call = (path: string, method = 'GET', body?: unknown, cookie?: string, csrf = true, crossSite = false) => fetch(base + path, {
    method, headers: {
      'content-type': 'application/json', 'x-forwarded-for': ip,
      ...(csrf ? { 'X-Meduha-Request': '1' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(crossSite ? { 'Sec-Fetch-Site': 'cross-site' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const credentials = { login: 'admin', password: fixtureEnv.MEDUHA_ADMIN_PASSWORD };
  const login = async () => {
    const response = await call('/admin/login/password', 'POST', credentials);
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie')!; assert(header);
    assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=Strict/i);
    assert.match(header, /Path=\/api\/meduha\/admin/i); assert.match(header, /Max-Age=28800/i);
    if (process.env.NODE_ENV === 'production') assert.match(header, /Secure/i);
    const cookie = header.split(';')[0];
    sessionHashes.push(hash(cookie.split('=')[1]));
    const text = await response.text();
    assert(!text.includes(credentials.password), 'API never returns credentials');
    const payload = JSON.parse(text);
    assert.equal(payload.authenticated, true);
    assert(Date.parse(payload.expiresAt) > Date.now() + 7 * 60 * 60 * 1000);
    return cookie;
  };
  try {
    await pool.query('INSERT INTO meduha_accounts (id, first_name) VALUES ($1, $2)', [userId, 'Password fixture']);
    assert.equal((await call('/admin/login/password', 'POST', credentials, undefined, false)).status, 403);
    assert.equal((await call('/admin/login/password', 'POST', credentials, undefined, true, true)).status, 403);
    assert.equal((await call('/admin/channels')).status, 403);
    const wrong = await call('/admin/login/password', 'POST', { ...credentials, password: randomUUID() });
    const unknown = await call('/admin/login/password', 'POST', { ...credentials, login: 'unknown' });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json(), 'unknown login and wrong password use the same error');

    const cookie = await login();
    for (const path of ['/admin/channels', '/admin/models', '/admin/users', '/admin/finance', '/admin/ledger',
      '/admin/statistics', '/admin/templates', '/admin/reports', '/admin/jobs', '/admin/audit', '/admin/generations/seedance']) {
      assert.equal((await call(path, 'GET', undefined, cookie)).status, 200, `${path} accepts temporary admin`);
    }
    const status = await (await call('/admin/login', 'GET', undefined, cookie)).json() as Record<string, unknown>;
    assert.equal(status.authMethod, 'temporary'); assert.equal(status.adminId, TEMPORARY_ADMIN_ACTOR);
    assert.equal(status.passwordLoginAvailable, true);
    assert.equal((await call('/bootstrap', 'GET', undefined, cookie)).status, 401, 'not a user identity');
    assert.equal((await call('/admin/pairing', 'POST', {}, cookie)).status, 401, 'cannot issue Telegram codes');
    assert.equal((await call('/admin/logout', 'POST', {}, cookie, false)).status, 403);
    assert.equal((await call('/admin/credits/adjust', 'POST', {
      userId, delta: 3, reason: adjustmentKey, idempotencyKey: adjustmentKey,
    }, cookie, false)).status, 403);
    assert.equal((await call('/admin/credits/adjust', 'POST', {
      userId, delta: 3, reason: adjustmentKey, idempotencyKey: adjustmentKey,
    }, cookie)).status, 200, 'finance accepts non-Telegram actor');
    const { rows: ledger } = await pool.query('SELECT actor_id FROM meduha_finance_ledger WHERE idempotency_key = $1', [adjustmentKey]);
    assert.equal(ledger[0].actor_id, TEMPORARY_ADMIN_ACTOR);
    const { rows: audits } = await pool.query('SELECT actor_id FROM meduha_admin_audit WHERE entity_id = $1', [userId]);
    assert.equal(audits[0].actor_id, TEMPORARY_ADMIN_ACTOR);

    const logout = await call('/admin/logout', 'POST', {}, cookie);
    assert.equal(logout.status, 204); assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await call('/admin/channels', 'GET', undefined, cookie)).status, 403);
    const expiring = await login();
    await pool.query('UPDATE meduha_admin_sessions SET expires_at = clock_timestamp() - interval \'1 second\' WHERE token_hash = $1', [sessionHashes.at(-1)]);
    assert.equal((await call('/admin/channels', 'GET', undefined, expiring)).status, 403);
    const revocable = await login();
    config = temporaryAdminConfig({ ...fixtureEnv, MEDUHA_ADMIN_PASSWORD: randomBytes(32).toString('hex') });
    assert.equal((await call('/admin/channels', 'GET', undefined, revocable)).status, 403);
    config = initialConfig;
    assert.equal((await call('/admin/channels', 'GET', undefined, revocable)).status, 403, 'revoked session stays revoked');
    const disabled = await login();
    config = null;
    assert.equal((await call('/admin/channels', 'GET', undefined, disabled)).status, 403);
    const disabledStatus = await (await call('/admin/login')).json() as Record<string, unknown>;
    assert.equal(disabledStatus.passwordLoginAvailable, false);
    assert.equal((await call('/admin/login/password', 'POST', credentials)).status, 401);
    config = initialConfig;

    await pool.query('DELETE FROM meduha_admin_login_attempts WHERE key = $1', [rateKey]);
    const responses = await Promise.all(Array.from({ length: PASSWORD_ATTEMPT_LIMIT + 3 }, () =>
      call('/admin/login/password', 'POST', { login: 'unknown', password: randomUUID() })));
    assert.equal(responses.filter(r => r.status === 401).length, PASSWORD_ATTEMPT_LIMIT);
    assert.equal(responses.filter(r => r.status === 429).length, 3);
    assert.equal(responses.find(r => r.status === 429)?.headers.get('retry-after'), '900');
    assert.equal((await call('/admin/login/password', 'POST', credentials)).status, 429, 'correct credentials cannot bypass lockout');
    await pool.query('UPDATE meduha_admin_login_attempts SET expires_at = clock_timestamp() - interval \'1 second\' WHERE key = $1', [rateKey]);
    await login();
    // Regression: independent Telegram ownership, pairing, single-use, revocation.
    config = null;
    telegramAdminEnabled = true;
    const initData = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: Number(telegramId), first_name: 'Pairing fixture' }),
    });
    const signingKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    initData.set('hash', createHmac('sha256', signingKey)
      .update([...initData.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
    const telegram = await call('/auth/telegram', 'POST', { initData: initData.toString() });
    assert.equal(telegram.status, 200);
    const telegramCookie = telegram.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await call('/admin/channels', 'GET', undefined, telegramCookie)).status, 200);
    const pairing = await call('/admin/pairing', 'POST', {}, telegramCookie);
    assert.equal(pairing.status, 201);
    const { code } = await pairing.json() as { code: string };
    const paired = await call('/admin/login', 'POST', { code });
    assert.equal(paired.status, 200, 'Telegram pairing remains usable when password login is disabled');
    const pairedCookie = paired.headers.get('set-cookie')!.split(';')[0];
    sessionHashes.push(hash(pairedCookie.split('=')[1]));
    assert.equal((await call('/admin/login', 'POST', { code })).status, 401);
    const pairedStatus = await (await call('/admin/login', 'GET', undefined, pairedCookie)).json() as Record<string, unknown>;
    assert.equal(pairedStatus.authMethod, 'telegram');
    assert.equal((await call('/admin/channels', 'GET', undefined, pairedCookie)).status, 200);
    telegramAdminEnabled = false;
    assert.equal((await call('/admin/channels', 'GET', undefined, pairedCookie)).status, 403);
    const { rows: account } = await pool.query('SELECT id FROM meduha_accounts WHERE id = $1', [TEMPORARY_ADMIN_ACTOR]);
    assert.equal(account.length, 0, 'no fake Telegram account is created');
    assert.deepEqual((await pool.query('SELECT * FROM meduha_template_admin WHERE slot = 1')).rows, ownerBefore);
    assert.deepEqual((await pool.query('SELECT * FROM meduha_finance_settings WHERE id = 1')).rows, financeBefore);
  } finally {
    server.close(); await once(server, 'close');
    await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id = $1 OR entity_id = ANY($2::text[])', [userId, sessionHashes]);
    await pool.query('DELETE FROM meduha_admin_sessions WHERE token_hash = ANY($1::text[])', [sessionHashes]);
    await pool.query('DELETE FROM meduha_admin_login_attempts WHERE key = $1', [rateKey]);
    await pool.query('DELETE FROM meduha_admin_pairings WHERE admin_id = $1', [telegramId]);
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE idempotency_key = $1', [adjustmentKey]);
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = $1', [userId]);
    await pool.query('DELETE FROM meduha_accounts WHERE id = ANY($1::text[])', [[userId, telegramId]]);
    await pool.end();
  }
});
