import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { eq } from 'drizzle-orm';
import { db, pool, meduhaAiChannels, meduhaAiModels } from '@workspace/db';
import { AiChannelError, channelBase, channelCredential, channelBinding, discoverChannel, importChannelModels, readBoundedResponse, submitChannelImage, type AiChannel } from './ai-channels';
import { channelPhotoMetadata, channelPhotoPriceFingerprint, loadChannelPhoto } from './channel-photo';
import { assertPhotoQuote, photoRequestHash, signPhotoQuote, verifyPhotoQuote } from './photo-pricing';
import { storeChannelImage, PhotoResultValidationError } from './photo-storage';
import { createAiChannelRouter } from '../routes/meduha-ai-channels';

process.env.AI_PROVIDER_CHANNEL_TEST = 'fixture-not-a-real-key';
const channel = {
  id: randomUUID(), name: 'Channel adapter test', adapter: 'openai-compatible',
  baseUrl: 'https://apinet.cloud/v1', secretRef: 'secret://AI_PROVIDER_CHANNEL_TEST',
  enabled: false, priority: 0, concurrencyLimit: 1, dailyCreditLimit: 0, createdAt: new Date(), updatedAt: new Date(),
} satisfies AiChannel;
after(async () => { await pool.end(); });

test('API origin allowlist and key namespace reject credential exfiltration', () => {
  assert.equal(channelBase(channel), 'https://apinet.cloud/v1');
  for (const baseUrl of ['http://apinet.cloud/v1', 'https://127.0.0.1/v1', 'https://apinet.cloud.attacker.example/v1', 'https://user@apinet.cloud/v1', 'https://apinet.cloud/v1?secret=x', 'https://apinet.cloud/v1/../admin', 'https://apinet.cloud:444/v1']) {
    assert.throws(() => channelBase({ ...channel, baseUrl }), AiChannelError);
  }
  assert.throws(() => channelCredential({ secretRef: 'secret://SESSION_SECRET' }), AiChannelError);
  assert.throws(() => channelBase({ ...channel, adapter: 'higgsfield' }), AiChannelError);
});

test('discovery uses only authenticated GET and never infers photo support from a name', async () => {
  let calls = 0;
  const rows = await discoverChannel(channel, async (url, init) => {
    calls++;
    assert.equal(url, 'https://apinet.cloud/v1/models');
    assert.equal(init?.method ?? 'GET', 'GET');
    assert.equal(init?.redirect, 'error');
    return Response.json({ data: [
      { id: 'photo-looking-name', supported_endpoint_types: ['openai'] },
      { id: 'supported', supported_endpoint_types: ['image-generation', 'openai'] },
      { id: 'supported', supported_endpoint_types: ['image-generation'] },
      { id: '../invalid', supported_endpoint_types: ['image-generation'] },
    ] });
  });
  assert.equal(calls, 1);
  assert.deepEqual(rows.map(row => [row.id, row.importable]), [['photo-looking-name', false], ['supported', true]]);
});

test('provider failures are redacted and bounded; no retry even for 429', async () => {
  for (const status of [401, 429, 503]) {
    let calls = 0;
    await assert.rejects(discoverChannel(channel, async () => { calls++; return new Response('do-not-show-provider-body-or-secret', { status }); }), error => {
      assert.match((error as Error).message, new RegExp(String(status)));
      assert.doesNotMatch((error as Error).message, /do-not-show/);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(readBoundedResponse(new Response('abcdef'), 3), AiChannelError);
});

test('image transport sends exactly one request, no unsupported settings and no retry', async () => {
  let calls = 0;
  const result = await submitChannelImage(channel, 'fixture-model', 'A test picture', async (url, init) => {
    calls++;
    assert.equal(url, 'https://apinet.cloud/v1/images/generations');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'fixture-model', prompt: 'A test picture', n: 1 });
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
  });
  assert.equal(result.length, 1);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(submitChannelImage(channel, 'fixture-model', 'Prompt', async () => { calls++; throw new Error('connection lost'); }));
  assert.equal(calls, 1);
  await assert.rejects(submitChannelImage(channel, 'fixture-model', 'Prompt', async () => Response.json({ data: [] })), AiChannelError);
});

test('minimal model schema rejects references, injected settings and empty prompts', () => {
  assert.equal(channelPhotoMetadata(channel.id, 'fixture', { prompt: 'A picture' }, {}).endpoint, 'fixture');
  for (const parameters of [{ prompt: '' }, { prompt: 'x', quality: 'high' }, { prompt: 'x', n: 20 }, { prompt: 'x', image_url: 'https://attacker.example' }]) {
    assert.throws(() => channelPhotoMetadata(channel.id, 'fixture', parameters, {}), AiChannelError);
  }
  assert.throws(() => channelPhotoMetadata(channel.id, 'fixture', { prompt: 'x' }, { image_urls: [randomUUID()] }), AiChannelError);
});

test('signed fixed-credit quote binds account, model, input, channel and configured price', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'fixture-quote-secret';
  try {
    const metadata = channelPhotoMetadata(channel.id, 'fixture', { prompt: 'A picture' }, {});
    const binding = channelBinding(channel, 'fixture');
    const claims = {
      purpose: 'photo-price' as const, accountId: 'fixture-user', modelId: channel.id, idempotencyKey: 'fixture-request',
      requestHash: photoRequestHash(metadata), pricingFingerprint: channelPhotoPriceFingerprint(binding, 7),
      creditPrice: 7, expiresAt: Date.now() + 60_000, usdMicros: 0,
    };
    const token = signPhotoQuote(claims);
    const verified = verifyPhotoQuote(token);
    assertPhotoQuote(verified, claims.accountId, channel.id, claims.idempotencyKey, metadata, 7);
    assert.throws(() => assertPhotoQuote(verified, 'other-user', channel.id, claims.idempotencyKey, metadata, 7));
    assert.throws(() => assertPhotoQuote(verified, claims.accountId, channel.id, claims.idempotencyKey, metadata, 8));
    assert.throws(() => verifyPhotoQuote(`${token}tampered`));
    assert.notEqual(binding, channelBinding({ ...channel, adapter: 'apinet' }, 'fixture'));
    assert.notEqual(claims.pricingFingerprint, channelPhotoPriceFingerprint(binding, 8));
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});

test('base64 image validation happens before any storage write', async () => {
  await assert.rejects(storeChannelImage(randomUUID(), { b64_json: 'not an image!' }), PhotoResultValidationError);
  await assert.rejects(storeChannelImage(randomUUID(), { b64_json: Buffer.from('a fake PNG body').toString('base64') }), PhotoResultValidationError);
});

test('async admin guard rejects without reaching database or upstream', async () => {
  const app = express();
  app.use(createAiChannelRouter(async (_req, res) => { res.status(401).json({ error: 'sign-in required' }); return null; }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/channels/${channel.id}/discover`, { method: 'POST' });
    assert.equal(response.status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('catalog import is atomic, repeat-safe and preserves existing price and enablement', async () => {
  const originalFetch = globalThis.fetch;
  const before = (await pool.query('SELECT spending_enabled FROM meduha_finance_settings')).rows;
  await db.insert(meduhaAiChannels).values(channel);
  globalThis.fetch = async () => Response.json({ data: [
    { id: 'fixture-supported', supported_endpoint_types: ['image-generation'] },
    { id: 'fixture-unknown', supported_endpoint_types: ['openai'] },
  ] });
  try {
    await assert.rejects(importChannelModels(channel, ['fixture-unknown']), AiChannelError);
    assert.equal(await importChannelModels(channel, ['fixture-supported']), 1);
    let rows = await db.select().from(meduhaAiModels).where(eq(meduhaAiModels.channelId, channel.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, false);
    assert.equal(rows[0].creditPrice, 0);
    await db.update(meduhaAiModels).set({ creditPrice: 7 }).where(eq(meduhaAiModels.id, rows[0].id));
    await Promise.all([importChannelModels(channel, ['fixture-supported']), importChannelModels(channel, ['fixture-supported'])]);
    rows = await db.select().from(meduhaAiModels).where(eq(meduhaAiModels.channelId, channel.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, false);
    assert.equal(rows[0].creditPrice, 7);
    assert.equal((await loadChannelPhoto(rows[0].id, false)).model.id, rows[0].id);
    await assert.rejects(loadChannelPhoto(rows[0].id), AiChannelError);
    const afterState = (await pool.query('SELECT spending_enabled FROM meduha_finance_settings')).rows;
    assert.deepEqual(afterState, before);
  } finally {
    globalThis.fetch = originalFetch;
    await db.delete(meduhaAiModels).where(eq(meduhaAiModels.channelId, channel.id));
    await db.delete(meduhaAiChannels).where(eq(meduhaAiChannels.id, channel.id));
  }
});
