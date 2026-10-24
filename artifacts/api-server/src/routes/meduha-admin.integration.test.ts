import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';
import { isAdminSetupRequired, isTemplateAdmin } from '../lib/template-admin';
import { ADMIN_ACCESS_CLEANUP_LOCK, cleanupExpiredMeduhaAdminAccess } from '../lib/meduha-admin-cleanup';
import { runMeduhaAdminCleanupSafely } from '../lib/meduha-admin-cleanup-worker';

const fixtureToken = '123456:admin-test-token-never-real';
const catalogChannelName = `Higgsfield catalog fixture ${randomUUID()}`;
const catalogDocuments = new Map([
  ['/docs/models/video-generation.md', `# Video Generation API
Choose from **1 model family** and **1 catalog entry**.
## Models
[FixtureModel · 1 workflow
Fixture Video
View API reference →](/docs/models/fixture-video.md)`],
  ['/docs/models/image-generation.md', '# Image Generation API\nChoose from **0 model families** and **0 catalog entries**.\n## Models\n'],
  ['/docs/models/fixture-video.md', `# Fixture Video API
**Endpoint:** \`POST https://api.higgsfield.ai/fixture/video-v1\`
**Endpoint ID:** \`fixture/video-v1\`
**Complete JSON schema**
\`\`\`json
{ "type": "object", "required": ["prompt"], "properties": { "prompt": { "type": "string", "minLength": 1 } } }
\`\`\`
`],
]);
const fixtureSchemaUrl = 'https://docs.higgsfield.ai/docs/models/fixture-video.md';
const catalogRequests: Array<{ url: string; method: string }> = [];
const catalogFetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://docs.higgsfield.ai', 'catalog access must stay on official docs');
  assert.ok(init?.method === undefined || init.method === 'GET', 'catalog discovery must remain read-only');
  catalogRequests.push({ url: `${url.origin}${url.pathname}`, method: init?.method ?? 'GET' });
  const body = catalogDocuments.get(url.pathname);
  return new Response(body ?? 'not found', { status: body ? 200 : 404 });
};

function signed(id: number) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Admin route fixture' }),
  });
  const key = createHmac('sha256', 'WebAppData').update(fixtureToken).digest();
  params.set('hash', createHmac('sha256', key)
    .update([...params.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return params.toString();
}

test('admin API auth, pairing, configuration, moderation, audit and finance integration', async () => {
  const pin = process.env.MEDUHA_ADMIN_TELEGRAM_ID;
  const fixtureId = () => {
    let value: string;
    do { value = String(4_503_599_002_000_000 + randomInt(1_000_000)); } while (value === pin);
    return value;
  };
  const adminId = fixtureId(), ordinaryId = fixtureId();
  const templateId = randomUUID();
  const channelName = `Fixture gateway ${randomUUID()}`;
  const adjustmentKey = `admin-integration-${randomUUID()}`;
  const paginationAdjustmentKey = `admin-integration-pagination-${randomUUID()}`;
  const expiredCode = randomBytes(32).toString('hex');
  const expiredCodeHash = createHash('sha256').update(expiredCode).digest('hex');
  let catalogChannelId: string | null = null;
  let importedCatalogModelId: string | null = null;
  const { rows: beforeRows } = await pool.query('SELECT slot, telegram_id FROM meduha_template_admin WHERE slot = 1');
  const { rows: financeBefore } = await pool.query('SELECT * FROM meduha_finance_settings WHERE id = 1');
  let server: Server;
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/meduha', createMeduhaRouter(
    () => fixtureToken, async () => 'admin_test_bot', async id => id === adminId, false, catalogFetcher,
  ));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/meduha`;
  const call = (path: string, method = 'GET', body?: unknown, cookie?: string, csrf = true) => fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(csrf ? { 'X-Meduha-Request': '1' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async (id: string) => {
    const response = await call('/auth/telegram', 'POST', { initData: signed(Number(id)) });
    assert.equal(response.status, 200);
    const value = response.headers.get('set-cookie')?.split(';')[0];
    assert(value);
    return value;
  };
  let channelId: string | null = null;
  let modelId: string | null = null;
  let issuedPairHash: string | null = null;
  try {
    assert.equal((await call('/admin/channels')).status, 403, 'guests cannot access admin operations');
    assert.equal((await call('/admin/higgsfield/catalog')).status, 403, 'guests cannot refresh the provider catalog');
    assert.equal((await call('/admin/higgsfield/import', 'POST', { channelId: randomUUID(), endpointIds: ['bytedance/seedance-2.5/text-to-video'] })).status, 403,
      'guests cannot import provider models');
    assert.equal((await call('/admin/credits/adjust', 'POST', {
      userId: ordinaryId, delta: 100, reason: 'unauthorized', idempotencyKey: 'test-key-0001',
    })).status, 403);
    assert.equal((await call('/admin/pairing', 'POST', {})).status, 401, 'guest cannot issue a pairing code');
    assert.equal((await call('/admin/pairing', 'POST', {}, undefined, false)).status, 403, 'pairing mutations require CSRF header');

    await pool.query(
      `INSERT INTO meduha_admin_pairings (code_hash, admin_id, expires_at)
       VALUES ($1, $2, $3)`,
      [expiredCodeHash, adminId, new Date(Date.now() - 1_000)],
    );
    assert.equal((await call('/admin/login', 'POST', { code: expiredCode })).status, 401, 'expired code is denied');
    const { rows: expiredRows } = await pool.query(
      'SELECT consumed_at FROM meduha_admin_pairings WHERE code_hash = $1', [expiredCodeHash],
    );
    assert.equal(expiredRows[0].consumed_at, null);

    const adminTelegramCookie = await login(adminId);
    const ordinaryCookie = await login(ordinaryId);
    const previousPin = process.env.MEDUHA_ADMIN_TELEGRAM_ID;
    try {
      process.env.MEDUHA_ADMIN_TELEGRAM_ID = adminId;
      assert.equal(await isTemplateAdmin(adminId), true, 'explicit pin works for an existing verified session without changing legacy designation');
      assert.equal(await isTemplateAdmin(ordinaryId), false);
      process.env.MEDUHA_ADMIN_TELEGRAM_ID = 'invalid-owner';
      assert.equal(await isAdminSetupRequired(), true, 'invalid explicit configuration fails closed');
    } finally {
      if (previousPin === undefined) delete process.env.MEDUHA_ADMIN_TELEGRAM_ID;
      else process.env.MEDUHA_ADMIN_TELEGRAM_ID = previousPin;
    }
    assert.equal((await call('/admin/channels', 'GET', undefined, ordinaryCookie)).status, 403,
      'an ordinary confirmed Telegram account cannot access admin operations');
    assert.equal((await call('/admin/pairing', 'POST', {}, ordinaryCookie)).status, 403,
      'ordinary Telegram account cannot issue pairing codes');
    const status = await (await call('/admin/login', 'GET', undefined, ordinaryCookie)).json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(status).sort(), ['authenticated', 'isAdmin', 'pairingLoginAvailable', 'passwordLoginAvailable', 'setupRequired']);
    assert.equal(status.authenticated, false);
    assert.equal(status.isAdmin, false);
    assert.equal(Object.hasOwn(status, 'accountId'), false, 'setup response must not expose IDs');
    assert.equal(Object.hasOwn(status, 'adminId'), false, 'unauthenticated admin status must not expose admin IDs');

    const pairing = await call('/admin/pairing', 'POST', {}, adminTelegramCookie);
    assert.equal(pairing.status, 201);
    const pairingValue = await pairing.json() as { code: string; expiresAt: string };
    assert.match(pairingValue.code, /^[a-f0-9]{64}$/);
    assert(Date.parse(pairingValue.expiresAt) > Date.now());
    issuedPairHash = createHash('sha256').update(pairingValue.code).digest('hex');
    const staleUsedCodeHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const expiredSessionHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const activeSessionToken = randomBytes(32).toString('hex');
    const activeSessionHash = createHash('sha256').update(activeSessionToken).digest('hex');
    const cleanupExpiredCodeHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const cleanupExpiredUsedCodeHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const cleanupNow = new Date();
    await pool.query(
      `INSERT INTO meduha_admin_pairings (code_hash, admin_id, expires_at, consumed_at)
       VALUES
         ($1, $2, $3, NULL),
         ($4, $2, $5, $6),
         ($7, $2, $8, $9)`,
      [
        cleanupExpiredCodeHash, adminId, new Date(cleanupNow.getTime() - 60_000),
        cleanupExpiredUsedCodeHash, new Date(cleanupNow.getTime() + 60_000),
        new Date(cleanupNow.getTime() - 31 * 24 * 60 * 60 * 1000),
        staleUsedCodeHash, new Date(cleanupNow.getTime() + 60_000),
        new Date(cleanupNow.getTime() - 60 * 60 * 1000),
      ],
    );
    await pool.query(
      `INSERT INTO meduha_admin_sessions (token_hash, admin_id, expires_at)
       VALUES ($1, $2, $3), ($4, $2, $5)`,
      [
        expiredSessionHash, adminId, new Date(cleanupNow.getTime() - 60_000),
        activeSessionHash, new Date(cleanupNow.getTime() + 60 * 60 * 1000),
      ],
    );
    const cleanupResult = await cleanupExpiredMeduhaAdminAccess();
    assert.equal(cleanupResult.acquired, true, 'cleanup acquired the cross-server lock');
    assert(cleanupResult.pairingsRemoved >= 2, 'expired and retention-aged used codes are removed');
    assert(cleanupResult.sessionsRemoved >= 1, 'expired sessions are removed');
    const { rows: retainedPairings } = await pool.query(
      'SELECT code_hash FROM meduha_admin_pairings WHERE code_hash = ANY($1::text[])',
      [[issuedPairHash, cleanupExpiredUsedCodeHash, staleUsedCodeHash]],
    );
    assert.deepEqual(
      retainedPairings.map(row => row.code_hash).sort(),
      [issuedPairHash, staleUsedCodeHash].sort(),
      'the active pairing and recently consumed pairing are retained, while old used codes are purged',
    );
    const { rows: retainedSessions } = await pool.query(
      'SELECT token_hash FROM meduha_admin_sessions WHERE token_hash = ANY($1::text[])',
      [[expiredSessionHash, activeSessionHash]],
    );
    assert.deepEqual(retainedSessions.map(row => row.token_hash), [activeSessionHash],
      'active sessions are retained and expired sessions are deleted');
    const lockHolder = await pool.connect();
    try {
      await lockHolder.query('BEGIN');
      await lockHolder.query(
        'SELECT pg_advisory_xact_lock($1, $2)',
        [ADMIN_ACCESS_CLEANUP_LOCK.namespace, ADMIN_ACCESS_CLEANUP_LOCK.key],
      );
      const skippedCleanup = await cleanupExpiredMeduhaAdminAccess();
      assert.equal(skippedCleanup.acquired, false, 'a second API server skips cleanup while the database lock is held');
      assert.equal(skippedCleanup.pairingsRemoved, 0);
      assert.equal(skippedCleanup.sessionsRemoved, 0);
    } finally {
      await lockHolder.query('ROLLBACK').catch(() => {});
      lockHolder.release();
    }
    assert.equal((await call('/admin/channels', 'GET', undefined, `meduha_admin_session=${activeSessionToken}`)).status, 200,
      'a retained active session still authorizes administrator requests');
    await assert.doesNotReject(
      runMeduhaAdminCleanupSafely(
        async () => { throw new Error('simulated cleanup failure'); },
        () => {},
      ),
      'cleanup failures are contained by the background worker',
    );
    const [loginCleanupResult, codeLogins] = await Promise.all([
      cleanupExpiredMeduhaAdminAccess(),
      Promise.all([
        call('/admin/login', 'POST', { code: pairingValue.code }),
        call('/admin/login', 'POST', { code: pairingValue.code }),
      ]),
    ]);
    assert.equal(loginCleanupResult.acquired, true);
    assert.deepEqual(codeLogins.map(response => response.status).sort(), [200, 401],
      'pairing code can be consumed atomically once only');
    const adminCookieResponse = codeLogins.find(response => response.status === 200)!;
    const adminCookie = adminCookieResponse.headers.get('set-cookie')?.split(';')[0];
    assert(adminCookie);
    assert.equal((await call('/admin/login', 'POST', { code: pairingValue.code })).status, 401,
      'a consumed code stays unusable after cleanup');
    const cookieHeader = adminCookieResponse.headers.get('set-cookie') ?? '';
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Strict/i);
    assert.match(cookieHeader, /Path=\/api\/meduha\/admin/i);
    assert.equal((await call('/admin/channels', 'GET', undefined, adminCookie)).status, 200,
      'admin-only browser cookie authorizes admin APIs');
    assert.equal((await call('/admin/jobs?limit=201', 'GET', undefined, adminCookie)).status, 400,
      'array endpoints enforce the shared page-size ceiling');
    const adminStatus = await (await call('/admin/login', 'GET', undefined, adminCookie)).json() as Record<string, unknown>;
    assert.equal(adminStatus.adminId, adminId, 'authenticated admin status exposes only the authorized admin ID');
    assert.equal((await call('/bootstrap', 'GET', undefined, adminCookie)).status, 401,
      'admin cookie does not authorize ordinary account routes');
    assert.equal((await call('/admin/pairing', 'POST', {}, adminCookie)).status, 401,
      'pairing issuance requires the Telegram account session, not the admin cookie');

    const catalogPreviewResponse = await call('/admin/higgsfield/catalog', 'GET', undefined, adminCookie);
    assert.equal(catalogPreviewResponse.status, 200);
    const catalogPreview = await catalogPreviewResponse.json() as {
      status: string; sourceUrls: string[]; warnings: string[];
      entries: Array<{ endpointId: string; schemaAvailable: boolean; parameters: Array<{ name: string; required: boolean }> }>;
    };
    assert.equal(catalogPreview.status, 'partial', 'an empty category page is not presented as a complete catalog');
    assert.match(catalogPreview.warnings.join(' '), /не содержит ссылок на модели/);
    assert.deepEqual(catalogPreview.entries.map(entry => entry.endpointId), ['fixture/video-v1']);
    assert.equal(catalogPreview.entries[0].schemaAvailable, true);
    assert.deepEqual(catalogPreview.entries[0].parameters.map(parameter => [parameter.name, parameter.required]), [['prompt', true]]);
    assert(catalogPreview.sourceUrls.every(url => new URL(url).origin === 'https://docs.higgsfield.ai'));
    assert(catalogRequests.every(request => request.url.startsWith('https://docs.higgsfield.ai/docs/models/') && request.method === 'GET'),
      'catalog lookup is read-only and restricted to official model documentation');

    const createChannel = await call('/admin/channels', 'POST', {
      name: channelName, baseUrl: 'https://gateway.example.test/api', adapter: 'fixture-adapter',
      secretRef: 'secret://meduha_fixture_gateway',
      priority: 10, concurrencyLimit: 3, dailyCreditLimit: 100,
    }, adminCookie);
    assert.equal(createChannel.status, 201);
    const channel = await createChannel.json() as { id: string; enabled: boolean; secretRef: string | null };
    channelId = channel.id;
    assert.equal(channel.enabled, false, 'new channels default to disabled');
    assert.equal(channel.secretRef, 'secret://meduha_fixture_gateway', 'safe secret references round trip');
    assert.equal((await call(`/admin/channels/${channelId}`, 'GET', undefined, adminCookie)).status, 200);
    const injectedSecret = await call('/admin/channels', 'POST', {
      name: 'Rejected secret', baseUrl: 'https://gateway.example.test', adapter: 'fixture',
      priority: 0, concurrencyLimit: 1, dailyCreditLimit: 1, apiKey: 'do-not-store',
    }, adminCookie);
    assert.equal(injectedSecret.status, 400, 'actual provider secret fields are rejected');
    const secretValue = 'sk_live_51MeduhaFixtureCredentialMustNeverPersist';
    const rawSecretRef = await call(`/admin/channels/${channelId}`, 'PATCH', { secretRef: secretValue }, adminCookie);
    assert.equal(rawSecretRef.status, 400, 'a provider credential value is not accepted as a secret reference');
    const { rows: storedSecretValue } = await pool.query(
      'SELECT id FROM meduha_ai_channels WHERE id = $1 AND secret_ref = $2', [channelId, secretValue],
    );
    assert.equal(storedSecretValue.length, 0, 'credential values are never stored in secret_ref');
    const urlSecret = await call('/admin/channels', 'POST', {
      name: 'Rejected URL secret', baseUrl: 'https://gateway.example.test/api?api_key=never-store',
      adapter: 'fixture', priority: 0, concurrencyLimit: 1, dailyCreditLimit: 1,
    }, adminCookie);
    assert.equal(urlSecret.status, 400, 'provider credentials cannot be hidden in a URL query');
    const updateChannel = await call(`/admin/channels/${channelId}`, 'PATCH', { enabled: true, secretRef: null }, adminCookie);
    assert.equal(updateChannel.status, 200);
    const clearedChannel = await (await call(`/admin/channels/${channelId}`, 'GET', undefined, adminCookie)).json() as { secretRef: string | null };
    assert.equal(clearedChannel.secretRef, null, 'secret references can be cleared without handling a credential value');

    const createModel = await call('/admin/models', 'POST', {
      channelId, upstreamId: 'upstream-photo-fixture', displayName: 'Fixture photo model',
      kind: 'photo', creditPrice: 7,
    }, adminCookie);
    assert.equal(createModel.status, 201);
    const model = await createModel.json() as { id: string; enabled: boolean };
    modelId = model.id;
    assert.equal(model.enabled, false, 'new models default to disabled');
    const invalidGenjutsuTariff = await call('/admin/models', 'POST', {
      channelId, upstreamId: 'upstream-photo-fixture', displayName: 'Invalid Genjutsu tariff',
      kind: 'photo', creditPrice: 7,
      genjutsuPricing: [{ scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 12 }],
    }, adminCookie);
    assert.equal(invalidGenjutsuTariff.status, 400, 'Genjutsu tariffs cannot be attached to unrelated models');
    const unsupportedGenjutsuChannel = await call('/admin/models', 'POST', {
      channelId, upstreamId: 'higgsfield/genjutsu/motion-transfer/v1.0', displayName: 'Wrong channel tariff',
      kind: 'video', creditPrice: 0,
      genjutsuPricing: [{ scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 12 }],
    }, adminCookie);
    assert.equal(unsupportedGenjutsuChannel.status, 400, 'Genjutsu tariffs require the Higgsfield adapter');
    assert.equal((await call(`/admin/models/${modelId}`, 'GET', undefined, adminCookie)).status, 200);
    assert.equal((await call(`/admin/models/${modelId}`, 'PATCH', { enabled: true }, adminCookie)).status, 200);
    const models = await (await call('/admin/models', 'GET', undefined, adminCookie)).json() as Array<{ id: string; enabled: boolean }>;
    assert.equal(models.find(item => item.id === modelId)?.enabled, true);

    const createCatalogChannel = await call('/admin/channels', 'POST', {
      name: catalogChannelName, baseUrl: 'https://api.higgsfield.ai', adapter: 'higgsfield',
      priority: 50, concurrencyLimit: 1, dailyCreditLimit: 0,
    }, adminCookie);
    assert.equal(createCatalogChannel.status, 201);
    catalogChannelId = (await createCatalogChannel.json() as { id: string }).id;
    const tariffModelResponse = await call('/admin/models', 'POST', {
      channelId: catalogChannelId, upstreamId: 'higgsfield/genjutsu/motion-transfer/v1.0',
      displayName: 'Genjutsu tariff fixture', kind: 'video', creditPrice: 0,
      genjutsuPricing: [{ scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 31 }],
    }, adminCookie);
    assert.equal(tariffModelResponse.status, 201);
    const tariffModel = await tariffModelResponse.json() as {
      id: string; enabled: boolean; creditPrice: number; genjutsuPricing: Array<{ scenario: string; resolution: string; duration: number; creditPrice: number }>;
    };
    assert.equal(tariffModel.enabled, false, 'setting prices does not enable the model');
    assert.equal(tariffModel.creditPrice, 0, 'a tariff does not invent or overwrite the legacy fixed price');
    assert.deepEqual(tariffModel.genjutsuPricing, [{ scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 31 }]);
    const wrongScenario = await call('/admin/models', 'POST', {
      channelId: catalogChannelId, upstreamId: 'higgsfield/genjutsu/motion-transfer/v1.0',
      displayName: 'Wrong scenario tariff', kind: 'video', creditPrice: 0,
      genjutsuPricing: [{ scenario: 'restyle', resolution: '720p', duration: 8, creditPrice: 31 }],
    }, adminCookie);
    assert.equal(wrongScenario.status, 400, 'a tariff scenario must match the model endpoint');
    const changedEndpoint = await call(`/admin/models/${tariffModel.id}`, 'PATCH', {
      upstreamId: 'fixture/video-v1',
    }, adminCookie);
    assert.equal(changedEndpoint.status, 400, 'an existing tariff cannot be orphaned by changing its endpoint');
    const duplicateGenjutsuTariff = await call(`/admin/models/${tariffModel.id}`, 'PATCH', {
      genjutsuPricing: [
        { scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 31 },
        { scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 32 },
      ],
    }, adminCookie);
    assert.equal(duplicateGenjutsuTariff.status, 400, 'duplicate tariff cells are rejected');
    const importModel = await call('/admin/higgsfield/import', 'POST', {
      channelId: catalogChannelId, endpointIds: ['fixture/video-v1'],
    }, adminCookie);
    assert.equal(importModel.status, 200);
    const importResult = await importModel.json() as {
      imported: Array<{ id: string; enabled: boolean; creditPrice: number; estimatedCost: number | null; limits: Record<string, number> }>;
      skipped: string[]; updated: string[];
    };
    assert.equal(importResult.imported.length, 1);
    assert.deepEqual(importResult.skipped, []);
    importedCatalogModelId = importResult.imported[0].id;
    assert.equal(importResult.imported[0].enabled, false);
    assert.equal(importResult.imported[0].creditPrice, 0);
    assert.equal(importResult.imported[0].estimatedCost, null);
    assert.deepEqual(importResult.imported[0].limits, {});
    assert.deepEqual(importResult.updated, []);
    const importedSchema = importResult.imported[0] as typeof importResult.imported[number] & {
      providerSchemaUrl: string | null;
      providerSchema: { schemaAvailable: boolean; parameters: Array<{ name: string; required: boolean }> } | null;
    };
    assert.equal(importedSchema.providerSchemaUrl, fixtureSchemaUrl);
    assert.deepEqual(importedSchema.providerSchema, { schemaAvailable: true, parameters: [{ name: 'prompt', type: 'string', required: true, minLength: 1 }] });

    const customizeImported = await call(`/admin/models/${importedCatalogModelId}`, 'PATCH', {
      enabled: true, creditPrice: 23, estimatedCost: 9, limits: { concurrencyLimit: 2, dailyCreditLimit: 300 },
    }, adminCookie);
    assert.equal(customizeImported.status, 200);
    const repeatImport = await call('/admin/higgsfield/import', 'POST', {
      channelId: catalogChannelId, endpointIds: ['fixture/video-v1'],
    }, adminCookie);
    assert.equal(repeatImport.status, 200);
    const repeated = await repeatImport.json() as { imported: unknown[]; skipped: string[]; updated: string[] };
    assert.deepEqual(repeated.imported, [], 'reimport never creates a duplicate');
    assert.deepEqual(repeated.skipped, ['fixture/video-v1']);
    assert.deepEqual(repeated.updated, [], 'unchanged provider metadata is not rewritten');
    catalogDocuments.set('/docs/models/fixture-video.md', `# Fixture Video API
**Endpoint:** \`POST https://api.higgsfield.ai/fixture/video-v1\`
**Endpoint ID:** \`fixture/video-v1\`
`);
    const missingSchemaCatalog = await call('/admin/higgsfield/catalog', 'GET', undefined, adminCookie);
    assert.equal(missingSchemaCatalog.status, 200);
    const missingSchemaPreview = await missingSchemaCatalog.json() as { status: string; warnings: string[]; entries: Array<{ schemaAvailable: boolean }> };
    assert.equal(missingSchemaPreview.status, 'partial', 'missing endpoint schema cannot be presented as a complete catalog');
    assert.equal(missingSchemaPreview.entries[0].schemaAvailable, false);
    assert.match(missingSchemaPreview.warnings.join(' '), /схема параметров недоступна/);
    const missingSchemaImport = await call('/admin/higgsfield/import', 'POST', {
      channelId: catalogChannelId, endpointIds: ['fixture/video-v1'],
    }, adminCookie);
    assert.equal(missingSchemaImport.status, 200);
    const missingSchemaResult = await missingSchemaImport.json() as { updated: string[] };
    assert.deepEqual(missingSchemaResult.updated, [], 'a temporarily unreadable provider schema does not replace saved parameters');
    catalogDocuments.set('/docs/models/fixture-video.md', `# Fixture Video API
**Endpoint:** \`POST https://api.higgsfield.ai/fixture/video-v1\`
**Endpoint ID:** \`fixture/video-v1\`
**Complete JSON schema**
\`\`\`json
{ "type": "object", "required": ["prompt", "duration"], "properties": { "prompt": { "type": "string", "minLength": 1 }, "duration": { "type": "integer", "minimum": 4, "maximum": 30 } } }
\`\`\`
`);
    const refreshedCatalog = await call('/admin/higgsfield/catalog', 'GET', undefined, adminCookie);
    assert.equal(refreshedCatalog.status, 200, 'metadata can be refreshed from the official documentation');
    const metadataImport = await call('/admin/higgsfield/import', 'POST', {
      channelId: catalogChannelId, endpointIds: ['fixture/video-v1'],
    }, adminCookie);
    assert.equal(metadataImport.status, 200);
    const metadataResult = await metadataImport.json() as { imported: unknown[]; skipped: string[]; updated: string[] };
    assert.deepEqual(metadataResult.imported, []);
    assert.deepEqual(metadataResult.skipped, ['fixture/video-v1']);
    assert.deepEqual(metadataResult.updated, ['fixture/video-v1']);
    const preserved = await (await call(`/admin/models/${importedCatalogModelId}`, 'GET', undefined, adminCookie)).json() as {
      enabled: boolean; creditPrice: number; estimatedCost: number | null; limits: Record<string, number>;
      providerSchemaUrl: string | null; providerSchema: { schemaAvailable: boolean; parameters: Array<{ name: string; required: boolean }> } | null;
    };
    assert.equal(preserved.enabled, true);
    assert.equal(preserved.creditPrice, 23);
    assert.equal(preserved.estimatedCost, 9);
    assert.deepEqual(preserved.limits, { concurrencyLimit: 2, dailyCreditLimit: 300 });
    assert.equal(preserved.providerSchemaUrl, fixtureSchemaUrl);
    assert.deepEqual(preserved.providerSchema?.parameters.map(parameter => [parameter.name, parameter.required]), [['prompt', true], ['duration', true]]);
    const modelsAfterRefresh = await (await call('/admin/models', 'GET', undefined, adminCookie)).json() as typeof preserved[];
    assert.deepEqual(modelsAfterRefresh.find(item => item.providerSchemaUrl === fixtureSchemaUrl)?.providerSchema, preserved.providerSchema,
      'saved schema and source are returned after reloading the model list');
    catalogDocuments.delete('/docs/models/fixture-video.md');
    const docsUnavailable = await call('/admin/higgsfield/catalog', 'GET', undefined, adminCookie);
    assert.equal(docsUnavailable.status, 200, 'cached catalog may be stale while provider docs are unavailable');
    assert.equal((await docsUnavailable.json() as { status: string }).status, 'stale',
      'a failed refresh must be exposed as stale rather than a complete catalog');
    assert.equal((await call(`/admin/models/${importedCatalogModelId}`, 'GET', undefined, adminCookie)).status, 200,
      'persisted schema remains available independently of documentation availability');
    catalogDocuments.set('/docs/models/fixture-video.md', `# Fixture Video API
**Endpoint:** \`POST https://api.higgsfield.ai/fixture/video-v1\`
**Endpoint ID:** \`fixture/video-v1\`
**Complete JSON schema**
\`\`\`json
{ "type": "object", "required": ["prompt", "duration"], "properties": { "prompt": { "type": "string", "minLength": 1 }, "duration": { "type": "integer", "minimum": 4, "maximum": 30 } } }
\`\`\`
`);

    const creditAdjustment = await call('/admin/credits/adjust', 'POST', {
      userId: ordinaryId, delta: 11, reason: 'admin integration grant', idempotencyKey: adjustmentKey,
    }, adminCookie);
    assert.equal(creditAdjustment.status, 200);
    const financeResult = await creditAdjustment.json() as { wallet: { balance: number }; ledgerEntry: { id: string; delta: number } };
    assert.equal(financeResult.wallet.balance, 11);
    assert.equal(financeResult.ledgerEntry.delta, 11);
    const secondAdjustment = await call('/admin/credits/adjust', 'POST', {
      userId: ordinaryId, delta: 3, reason: 'pagination fixture entry', idempotencyKey: paginationAdjustmentKey,
    }, adminCookie);
    assert.equal(secondAdjustment.status, 200);
    await pool.query(
      `UPDATE meduha_finance_ledger SET created_at = created_at - INTERVAL '1 second' WHERE id = $1`,
      [financeResult.ledgerEntry.id],
    );
    assert.equal((await call('/admin/ledger', 'GET', undefined, adminCookie)).status, 200);
    assert.equal((await call('/wallet', 'GET', undefined, ordinaryCookie)).status, 200,
      'a user can read their own finance-service wallet');
    const ownWallet = await (await call('/wallet?limit=1&offset=1', 'GET', undefined, ordinaryCookie)).json() as {
      ledger: Array<{ delta: number }>; pagination: { limit: number; offset: number };
    };
    assert.deepEqual(ownWallet.pagination, { limit: 1, offset: 1, totalLedger: 2, totalReservations: 0 });
    assert.equal(ownWallet.ledger[0]?.delta, 11, 'wallet offset reaches older history');
    assert.equal((await call('/wallet?limit=101', 'GET', undefined, ordinaryCookie)).status, 400,
      'wallet pagination is bounded');
    assert.equal((await call(`/admin/wallet?userId=${encodeURIComponent(ordinaryId)}&limit=101`, 'GET', undefined, adminCookie)).status, 400,
      'admin wallet pagination is bounded');
    const adminWalletResponse = await call(`/admin/wallet?userId=${encodeURIComponent(ordinaryId)}&limit=1&offset=1`, 'GET', undefined, adminCookie);
    assert.equal(adminWalletResponse.status, 200);
    const adminWallet = await adminWalletResponse.json() as {
      accountId: string; pagination: { limit: number; offset: number; totalLedger: number; totalReservations: number };
    };
    assert.equal(adminWallet.accountId, ordinaryId);
    assert.deepEqual(adminWallet.pagination, { limit: 1, offset: 1, totalLedger: 2, totalReservations: 0 });
    assert.equal((await call(`/admin/wallet?userId=${encodeURIComponent(ordinaryId)}`, 'GET', undefined, ordinaryCookie)).status, 403,
      'wallet by user ID is admin-only');
    assert.equal((await call('/admin/wallet', 'GET', undefined, adminCookie)).status, 400,
      'admin wallet requires a userId query parameter');

    assert.equal((await call('/admin/finance', 'PATCH', {
      spendingEnabled: true, dailyCreditLimit: 1_000_000, maxActiveReservations: 3,
    }, adminCookie)).status, 200);
    const reserveResponse = await call('/admin/credits/reserve', 'POST', {
      userId: ordinaryId, amount: 4, reason: 'route settlement fixture', idempotencyKey: randomUUID(),
    }, adminCookie);
    assert.equal(reserveResponse.status, 200);
    const held = await reserveResponse.json() as { reservation: { id: string } };
    const settleBody = { reason: 'route settlement fixture', idempotencyKey: randomUUID() };
    const settledResponse = await call(`/admin/credits/${held.reservation.id}/settle`, 'POST', settleBody, adminCookie);
    assert.equal(settledResponse.status, 200, 'settlement response remains serializable after commit');
    const settled = await settledResponse.json() as { wallet: { balance: number }; ledgerEntry: { budgetDay: string } };
    assert.equal(settled.wallet.balance, 10);
    assert.match(settled.ledgerEntry.budgetDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await call('/admin/ledger', 'GET', undefined, adminCookie)).status, 200, 'global ledger serializes SQL DATE fields');
    const replayResponse = await call(`/admin/credits/${held.reservation.id}/settle`, 'POST', settleBody, adminCookie);
    assert.equal(replayResponse.status, 200);
    assert.equal((await replayResponse.json() as { replayed: boolean }).replayed, true);
    assert.equal((await call('/wallet', 'GET', undefined, ordinaryCookie)).status, 200, 'wallet with dated budget entries serializes');
    const refundResponse = await call(`/admin/credits/${held.reservation.id}/refund`, 'POST', {
      reason: 'route refund fixture', idempotencyKey: randomUUID(),
    }, adminCookie);
    assert.equal(refundResponse.status, 200);
    const refunded = await refundResponse.json() as { wallet: { balance: number }; ledgerEntry: { budgetDay: string } };
    assert.equal(refunded.wallet.balance, 14);
    assert.equal(refunded.ledgerEntry.budgetDay, settled.ledgerEntry.budgetDay);
    const releaseHoldResponse = await call('/admin/credits/reserve', 'POST', {
      userId: ordinaryId, amount: 2, reason: 'route release fixture', idempotencyKey: randomUUID(),
    }, adminCookie);
    assert.equal(releaseHoldResponse.status, 200);
    const releaseHold = await releaseHoldResponse.json() as { reservation: { id: string } };
    assert.equal((await call(`/admin/credits/${releaseHold.reservation.id}/release`, 'POST', {
      reason: 'route release fixture', idempotencyKey: randomUUID(),
    }, adminCookie)).status, 200);
    assert.equal((await call('/admin/finance', 'PATCH', { spendingEnabled: false }, adminCookie)).status, 200);
    assert.equal((await call('/admin/credits/reserve', 'POST', {
      userId: ordinaryId, amount: 1, reason: 'disabled route fixture', idempotencyKey: randomUUID(),
    }, adminCookie)).status, 409, 'kill switch prevents new holds');

    const templateInsert = await pool.query(
      `INSERT INTO meduha_templates
        (id, owner_id, title, description, kind, poster, width, height, prompt, tags, parameters, status)
       VALUES ($1, $2, 'Report fixture', '', 'photo', 'images/fixture.png', 1, 1, 'fixture prompt',
         '[]'::jsonb, '{"model":"","style":"","ratio":"1:1","duration":""}'::jsonb, 'published')`,
      [templateId, ordinaryId],
    );
    assert.equal(templateInsert.rowCount, 1);
    assert.equal((await call('/reports', 'POST', { templateId, reason: 'guest report' })).status, 401);
    assert.equal((await call('/reports', 'POST', { templateId, reason: 'fixture report' }, ordinaryCookie)).status, 201);
    assert.equal((await call('/reports', 'POST', { templateId, reason: 'duplicate report' }, ordinaryCookie)).status, 200,
      'repeat reporter/template reports are deduplicated');
    const reportsPageResponse = await call('/admin/reports?limit=1&offset=0', 'GET', undefined, adminCookie);
    assert.equal(reportsPageResponse.status, 200);
    const reportPage = await reportsPageResponse.json() as unknown[];
    assert(reportPage.length <= 1, 'reports retain array response shape with pagination');
    const reports = await (await call('/admin/reports?limit=200&offset=0', 'GET', undefined, adminCookie)).json() as Array<{ templateId: string; status: string }>;
    const templatesPage = await (await call('/admin/templates?limit=1&offset=0', 'GET', undefined, adminCookie)).json() as unknown[];
    assert(Array.isArray(templatesPage) && templatesPage.length <= 1, 'templates retain array response shape with pagination');
    const jobsPage = await (await call('/admin/jobs?limit=1&offset=0', 'GET', undefined, adminCookie)).json() as unknown[];
    assert(Array.isArray(jobsPage), 'jobs retain array response shape with pagination');
    const report = reports.find(item => item.templateId === templateId);
    assert(report && report.status === 'pending');
    const adminTemplateUpdate = await call(`/admin/templates/${templateId}/publication`, 'PATCH', { status: 'draft' }, adminCookie);
    assert.equal(adminTemplateUpdate.status, 200);
    const audit = await (await call('/admin/audit', 'GET', undefined, adminCookie)).json() as { items: Array<{ actorId: string; action: string }> };
    assert(audit.items.some(item => item.actorId === adminId && item.action === 'credits.adjust'));
    const reportRow = reports.find(item => item.templateId === templateId);
    assert(reportRow);
    const { rows: reportIds } = await pool.query('SELECT id FROM meduha_reports WHERE reporter_id = $1 AND template_id = $2', [ordinaryId, templateId]);
    assert(reportIds[0]?.id);
    assert.equal((await call(`/admin/reports/${reportIds[0].id}`, 'PATCH', { status: 'dismissed' }, adminCookie)).status, 200);

    const block = await call(`/admin/users/${ordinaryId}/block`, 'PUT', { blocked: true }, adminCookie);
    assert.equal(block.status, 200);
    assert.equal((await call('/wallet', 'GET', undefined, ordinaryCookie)).status, 403,
      'blocked accounts cannot use signed-in account routes');
    assert.equal((await call(`/admin/users/${adminId}/block`, 'PUT', { blocked: true }, adminCookie)).status, 403,
      'admin cannot block its own designated test identity');
    assert.equal((await call(`/admin/users/${ordinaryId}/block`, 'PUT', { blocked: false }, adminCookie)).status, 200);

    assert.equal((await call('/admin/models', 'GET', undefined, adminCookie)).status, 200);
    assert.equal((await call(`/admin/models/${modelId}`, 'DELETE', undefined, adminCookie)).status, 204);
    modelId = null;
    assert.equal((await call(`/admin/channels/${channelId}`, 'DELETE', undefined, adminCookie)).status, 204);
    channelId = null;
    assert.equal((await call(`/admin/channels/${catalogChannelId}`, 'DELETE', undefined, adminCookie)).status, 204);
    catalogChannelId = null;
    importedCatalogModelId = null;
    const logout = await call('/admin/logout', 'POST', {}, adminCookie);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /meduha_admin_session=;/);
    assert.equal((await call('/admin/channels', 'GET', undefined, adminCookie)).status, 403,
      'logout revokes the durable admin cookie');
  } finally {
    if (financeBefore[0]) {
      const previous = financeBefore[0];
      await pool.query(
        `UPDATE meduha_finance_settings SET spending_enabled=$1, daily_credit_limit=$2,
          max_active_reservations=$3, updated_at=$4, updated_by=$5 WHERE id=1 AND updated_by=$6`,
        [previous.spending_enabled, previous.daily_credit_limit, previous.max_active_reservations,
          previous.updated_at, previous.updated_by, adminId],
      );
    } else {
      await pool.query('DELETE FROM meduha_finance_settings WHERE id=1 AND updated_by=$1', [adminId]);
    }
    const { rows: channelRows } = await pool.query('SELECT id FROM meduha_ai_channels WHERE name = ANY($1::text[])', [[channelName, catalogChannelName]]);
    const channelIds = channelRows.map(row => row.id);
    if (channelIds.length) await pool.query('DELETE FROM meduha_ai_channels WHERE id = ANY($1::text[])', [channelIds]);
    await pool.query('DELETE FROM meduha_admin_audit WHERE actor_id = ANY($1::text[])', [[adminId]]);
    await pool.query('DELETE FROM meduha_reports WHERE reporter_id = ANY($1::text[]) OR template_id = $2', [[ordinaryId, adminId], templateId]);
    await pool.query('DELETE FROM meduha_template_likes WHERE user_id = ANY($1::text[]) OR template_id = $2', [[ordinaryId, adminId], templateId]);
    await pool.query('DELETE FROM meduha_template_saves WHERE user_id = ANY($1::text[]) OR template_id = $2', [[ordinaryId, adminId], templateId]);
    await pool.query('DELETE FROM meduha_templates WHERE id = $1', [templateId]);
    await pool.query('DELETE FROM meduha_admin_pairings WHERE admin_id = ANY($1::text[]) OR code_hash = $2 OR code_hash = $3', [[adminId, ordinaryId], expiredCodeHash, issuedPairHash]);
    await pool.query('DELETE FROM meduha_admin_sessions WHERE admin_id = ANY($1::text[])', [[adminId, ordinaryId]]);
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE ledger_id IN (SELECT id FROM meduha_finance_ledger WHERE account_id = ANY($1::text[]))', [[adminId, ordinaryId]]);
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = ANY($1::text[])', [[adminId, ordinaryId]]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id = ANY($1::text[])', [[adminId, ordinaryId]]);
    await pool.query('DELETE FROM meduha_accounts WHERE id = ANY($1::text[])', [[adminId, ordinaryId]]);
    const { rows: afterRows } = await pool.query('SELECT slot, telegram_id FROM meduha_template_admin WHERE slot = 1');
    assert.deepEqual(afterRows, beforeRows, 'fixture authorization and account logins never mutate admin singleton');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
