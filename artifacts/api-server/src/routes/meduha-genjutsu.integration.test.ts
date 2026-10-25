import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { pool } from '@workspace/db';
import type { GenerationModelList, GenerationSubmission } from '@workspace/api-zod';
import { createMeduhaRouter } from './meduha';
import { FinanceError, getFinanceSettings, getWallet, reserveCredits, updateFinanceSettings } from '../lib/finance';
import { runGenerationWorkerOnce } from '../lib/generation-worker';
import {
  checkedVideoInfo, configuredGenjutsuPrice, genjutsuPricingFingerprint, GENJUTSU_ENDPOINTS, GenjutsuError, genjutsuProviderInput,
  signGenjutsuQuote, verifyGenjutsuQuote,
  prepareGenjutsuMedia, validateGenjutsuReferences,
} from '../lib/genjutsu';

test('Genjutsu validates scenario-specific media and sends only documented inputs', async () => {
  process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
  assert.throws(() => validateGenjutsuReferences('genjutsu', []), GenjutsuError);
  assert.throws(() => validateGenjutsuReferences('object-swap', ['a', 'a']), GenjutsuError);
  assert.throws(() => validateGenjutsuReferences('restyle', [], undefined), GenjutsuError);
  assert.throws(() => validateGenjutsuReferences('restyle', Array(6).fill('x'), randomUUID()), GenjutsuError);
  assert.throws(() => checkedVideoInfo({ streams: [{ codec_type: 'video', width: 1920, height: 1080 }], format: { duration: '3.9' } }, 'genjutsu'), GenjutsuError);
  assert.throws(() => checkedVideoInfo({ streams: [{ codec_type: 'video', width: 320, height: 240 }], format: { duration: '8' } }, 'object-swap'), GenjutsuError);
  assert.equal(checkedVideoInfo({ streams: [{ codec_type: 'video', width: 1280, height: 720 }], format: { duration: '31' } }, 'genjutsu').duration, 30);
  assert.equal(checkedVideoInfo({ streams: [{ codec_type: 'video', width: 1280, height: 720 }], format: { duration: '4.01' } }, 'genjutsu').duration, 5);
  const tariffs = [
    { scenario: 'genjutsu' as const, resolution: '720p' as const, duration: 8, creditPrice: 27 },
    { scenario: 'genjutsu' as const, resolution: '1080p' as const, duration: 8, creditPrice: 39 },
  ];
  assert.equal(configuredGenjutsuPrice(20, tariffs, { scenario: 'genjutsu', resolution: '720p', duration: 8 }), 27);
  assert.equal(configuredGenjutsuPrice(20, tariffs, { scenario: 'genjutsu', resolution: '720p', duration: 9 }), null);
  assert.equal(configuredGenjutsuPrice(20, [], { scenario: 'genjutsu', resolution: '1080p', duration: 30 }), 20);
  assert.notEqual(genjutsuPricingFingerprint(20, tariffs), genjutsuPricingFingerprint(21, tariffs));
  const claim = {
    version: 1 as const, accountId: randomUUID(), modelId: randomUUID(), scenario: 'genjutsu' as const,
    videoId: randomUUID(), resolution: '720p' as const, duration: 8, creditPrice: 27,
    pricingFingerprint: genjutsuPricingFingerprint(20, tariffs), expiresAt: Date.now() + 60_000,
  };
  assert.equal(verifyGenjutsuQuote(signGenjutsuQuote(claim)).creditPrice, 27);
  assert.throws(() => verifyGenjutsuQuote(signGenjutsuQuote({ ...claim, expiresAt: Date.now() - 1 })), GenjutsuError);
  const presetId = randomUUID();
  const input = await genjutsuProviderInput({
    prompt: '', resolution: '720p',
    _genjutsu: { scenario: 'restyle', endpoint: GENJUTSU_ENDPOINTS.restyle, videoId: 'video', imageIds: ['one', 'two'], presetId },
  }, async id => `https://fixtures.invalid/${id}`);
  assert.deepEqual(input, {
    prompt: '', resolution: '720p', video_url: 'https://fixtures.invalid/video',
    image_urls: ['https://fixtures.invalid/one', 'https://fixtures.invalid/two'], preset_id: presetId,
  });
  await assert.rejects(() => genjutsuProviderInput({
    prompt: '', resolution: '720p',
    _genjutsu: { scenario: 'genjutsu', endpoint: 'unverified/model', videoId: 'x', imageIds: ['y'] },
  }, async () => { throw new Error('must not sign'); }), /dispatch endpoint/);
});

test('Genjutsu jobs preserve media, idempotency, prices and credit lifecycle without paid provider calls', async t => {
  process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
  const accountId = `genjutsu-fixture-${randomUUID()}`;
  const token = randomBytes(32).toString('hex');
  const channelId = randomUUID();
  const modelIds = { genjutsu: randomUUID(), 'object-swap': randomUUID(), restyle: randomUUID() };
  const tariffs = [
    { scenario: 'genjutsu' as const, resolution: '720p' as const, duration: 8, creditPrice: 27 },
    { scenario: 'genjutsu' as const, resolution: '1080p' as const, duration: 8, creditPrice: 39 },
  ];
  const videoId = randomUUID(), imageId = randomUUID(), presetId = randomUUID();
  const previous = await getFinanceSettings();
  let invalidMedia = false;
  let availableStyles = true;
  try {
    await pool.query(`INSERT INTO meduha_accounts (id, first_name, credits) VALUES ($1,'Genjutsu test',300)`, [accountId]);
    await pool.query(`INSERT INTO meduha_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [
      createHash('sha256').update(token).digest('hex'), accountId,
    ]);
    await pool.query(`INSERT INTO meduha_ai_channels (id,name,base_url,adapter,enabled,priority,concurrency_limit,daily_credit_limit)
      VALUES ($1,'Genjutsu fixture','https://api.higgsfield.ai','higgsfield',true,10,100,100000)`, [channelId]);
    for (const scenario of Object.keys(modelIds) as (keyof typeof modelIds)[]) {
      await pool.query(`INSERT INTO meduha_ai_models (id,channel_id,upstream_id,display_name,kind,enabled,credit_price,limits,genjutsu_pricing)
        VALUES ($1,$2,$3,$4,'video',true,20,'{}',$5::jsonb)`, [
        modelIds[scenario], channelId, GENJUTSU_ENDPOINTS[scenario], scenario,
        JSON.stringify(scenario === 'genjutsu' ? tariffs.filter(tariff => tariff.scenario === scenario) : []),
      ]);
    }
    await updateFinanceSettings({ spendingEnabled: true, dailyCreditLimit: 1000000, perAccountDailyCreditLimit: 1000000, maxActiveReservations: 100 }, 'genjutsu-test');
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    app.use(express.json(), cookieParser());
    app.use('/api/meduha', createMeduhaRouter(
      () => undefined, async () => null, async () => false, false, undefined, undefined, {
        prepareMedia: async (owner, metadata) => {
          assert.equal(owner, accountId);
          assert.equal(metadata.videoId, videoId);
          if (invalidMedia) throw new GenjutsuError('Некорректное видео.');
          return { duration: 8, width: 1280, height: 720 };
        },
        styles: async () => availableStyles ? [{ id: presetId, name: 'Fixture', previewUrl: 'https://fixtures.invalid/style.webp' }] : [],
      },
    ));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address(); assert(address && typeof address === 'object');
    const call = (path: string, body?: unknown, authenticated = true, csrf = true) => fetch(`http://127.0.0.1:${address.port}/api/meduha${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-Meduha-Request': '1' } : {}), ...(authenticated ? { cookie: `meduha_session=${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const getQuote = async (modelId: string, scenario: keyof typeof modelIds, resolution: '480p' | '720p' | '1080p' = '720p') => {
      const response = await call('/genjutsu/quote', { modelId, scenario, videoId, resolution });
      return { response, quote: await response.json() as { quoteToken: string; creditPrice: number; duration: number; expiresAt: number } };
    };
    const body = {
      idempotencyKey: randomUUID(), modelId: modelIds.genjutsu, scenario: 'genjutsu',
      videoId, imageIds: [imageId], prompt: '', resolution: '720p',
    };
    assert.equal((await call('/genjutsu/generations', body, false)).status, 401);
    assert.equal((await call('/genjutsu/generations', body, true, false)).status, 403);
    const models = await (await call('/genjutsu/models')).json() as GenerationModelList;
    const configuredIds: string[] = Object.values(modelIds);
    assert.equal(models.models.filter(model => configuredIds.includes(model.id)).length, 3);
    assert.equal((await call('/genjutsu/generations', { ...body, imageIds: [] })).status, 400);
    assert.equal((await call('/genjutsu/generations', { ...body, modelId: modelIds.restyle, quoteToken: 'unused' })).status, 409);
    const quoteResult = await getQuote(modelIds.genjutsu, 'genjutsu');
    assert.equal(quoteResult.response.status, 200);
    assert.equal(quoteResult.quote.creditPrice, 27);
    assert.equal(quoteResult.quote.duration, 8);
    await assert.rejects(() => reserveCredits({
      accountId, actorId: accountId, amount: 27, reason: 'stale Genjutsu quote fixture',
      idempotencyKey: `stale-genjutsu-quote-${randomUUID()}`, modelId: modelIds.genjutsu, channelId,
      genjutsuQuote: {
        scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 27,
        pricingFingerprint: '0'.repeat(64),
      },
    }), (error: unknown) => error instanceof FinanceError && error.code === 'STALE_PRICE_QUOTE');
    assert.equal((await getWallet(accountId)).reserved, 0, 'a stale tariff cannot create a reservation');
    assert.equal((await getQuote(modelIds.genjutsu, 'genjutsu', '1080p')).quote.creditPrice, 39);
    assert.equal((await getQuote(modelIds.genjutsu, 'genjutsu', '480p')).response.status, 409,
      'an unconfigured combination does not silently use another tariff');
    await assert.rejects(() => prepareGenjutsuMedia(accountId, {
      scenario: 'genjutsu', endpoint: GENJUTSU_ENDPOINTS.genjutsu, videoId: randomUUID(), imageIds: [randomUUID()],
    }), GenjutsuError, 'missing/unowned files are rejected before signing or provider submission');
    invalidMedia = true;
    assert.equal((await call('/genjutsu/generations', { ...body, quoteToken: quoteResult.quote.quoteToken })).status, 400);
    invalidMedia = false;
    const [signedPayload, signature] = quoteResult.quote.quoteToken.split('.');
    const tamperedSignature = `${signature![0] === 'a' ? 'b' : 'a'}${signature!.slice(1)}`;
    const tamperedToken = `${signedPayload}.${tamperedSignature}`;
    assert.equal((await call('/genjutsu/generations', { ...body, idempotencyKey: randomUUID(), quoteToken: tamperedToken })).status, 409);
    const wrongResolutionQuote = { ...body, idempotencyKey: randomUUID(), resolution: '1080p', quoteToken: quoteResult.quote.quoteToken };
    assert.equal((await call('/genjutsu/generations', wrongResolutionQuote)).status, 409);
    const stalePrice = await getQuote(modelIds.genjutsu, 'genjutsu');
    await pool.query(`UPDATE meduha_ai_models SET genjutsu_pricing=$2::jsonb WHERE id=$1`, [
      modelIds.genjutsu, JSON.stringify([{ scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 28 }]),
    ]);
    assert.equal((await call('/genjutsu/generations', {
      ...body, idempotencyKey: randomUUID(), quoteToken: stalePrice.quote.quoteToken,
    })).status, 409, 'price changes after quote issuance are rejected');
    await pool.query(`UPDATE meduha_ai_models SET genjutsu_pricing=$2::jsonb WHERE id=$1`, [
      modelIds.genjutsu, JSON.stringify(tariffs.filter(tariff => tariff.scenario === 'genjutsu')),
    ]);
    const responses = await Promise.all([
      call('/genjutsu/generations', { ...body, quoteToken: quoteResult.quote.quoteToken }),
      call('/genjutsu/generations', { ...body, quoteToken: quoteResult.quote.quoteToken }),
    ]);
    assert.deepEqual(responses.map(response => response.status), [202, 202]);
    const accepted = await Promise.all(responses.map(response => response.json())) as GenerationSubmission[];
    assert.equal(accepted[0].job.id, accepted[1].job.id);
    assert.equal(accepted[0].job.scenario, 'genjutsu');
    assert.equal(accepted[0].job.creditPrice, 27);
    assert.equal((await getWallet(accountId)).reserved, 27);
    assert.equal((await call('/genjutsu/generations', { ...body, quoteToken: quoteResult.quote.quoteToken, resolution: '1080p' })).status, 409);
    assert.equal((await call('/genjutsu/generations', { ...body, quoteToken: quoteResult.quote.quoteToken, imageIds: [randomUUID()] })).status, 409);
    assert.equal((await call('/genjutsu/generations', body)).status, 202, 'previously stored jobs replay with the original key without requiring a refreshed quote');
    let submits = 0;
    const requestId = randomUUID();
    await runGenerationWorkerOnce({
      submit: async input => {
        submits++; assert.equal(input._genjutsu?.endpoint, GENJUTSU_ENDPOINTS.genjutsu);
        return { status: 'queued', request_id: requestId };
      },
      getStatus: async () => ({ status: 'canceled' }),
    });
    assert.equal(submits, 1);
    assert.equal((await getWallet(accountId)).reserved, 0, 'provider cancellation releases credits');
    const stored = await pool.query('SELECT status FROM meduha_generation_jobs WHERE id=$1', [accepted[0].job.id]);
    assert.equal(stored.rows[0].status, 'failed');
    const restyleQuote = await getQuote(modelIds.restyle, 'restyle');
    const restyle = { ...body, idempotencyKey: randomUUID(), scenario: 'restyle', modelId: modelIds.restyle, imageIds: [], presetId, quoteToken: restyleQuote.quote.quoteToken };
    assert.equal((await call(`/genjutsu/styles?modelId=${modelIds.restyle}`)).status, 200);
    availableStyles = false;
    assert.equal((await call('/genjutsu/generations', restyle)).status, 400, 'removed style blocks submission');
    availableStyles = true;
    assert.equal((await call('/genjutsu/generations', restyle)).status, 202);
    await runGenerationWorkerOnce({
      submit: async () => ({ status: 'completed', request_id: randomUUID(), video: { url: 'https://fixtures.invalid/result.mp4' } }),
      getStatus: async () => ({ status: 'completed', video: { url: 'https://fixtures.invalid/result.mp4' } }),
      storeVideo: async () => ({ size: 24, contentType: 'video/mp4' }),
    });
    assert.equal((await getWallet(accountId)).balance, 280, 'one completed run charges its configured price once');
    assert.equal((await getWallet(accountId)).reserved, 0);
    const swapQuote = await getQuote(modelIds['object-swap'], 'object-swap');
    const swap = { ...body, idempotencyKey: randomUUID(), scenario: 'object-swap', modelId: modelIds['object-swap'], quoteToken: swapQuote.quote.quoteToken };
    assert.equal((await call('/genjutsu/generations', swap)).status, 202);
    await runGenerationWorkerOnce({ submit: async () => { throw new Error('response lost'); }, getStatus: async () => ({ status: 'queued' }) });
    await runGenerationWorkerOnce({ submit: async () => { throw new Error('must not resubmit'); }, getStatus: async () => ({ status: 'queued' }) });
    const unknown = await (await call('/genjutsu/generations', swap)).json() as GenerationSubmission;
    assert.equal(unknown.job.status, 'unknown');
    assert.equal((await getWallet(accountId)).reserved, 20, 'ambiguous provider response retains one reservation');
    await pool.query(`UPDATE meduha_ai_models SET enabled=false WHERE channel_id=$1`, [channelId]);
    assert.equal((await call('/genjutsu/generations', swap)).status, 202, 'an existing intent is recoverable after model disabling');
  } finally {
    await pool.query('DELETE FROM meduha_generation_jobs WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE reservation_id IN (SELECT id FROM meduha_credit_reservations WHERE account_id=$1)', [accountId]);
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_sessions WHERE user_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_accounts WHERE id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_ai_models WHERE channel_id=$1', [channelId]);
    await pool.query('DELETE FROM meduha_ai_channels WHERE id=$1', [channelId]);
    await updateFinanceSettings({
      spendingEnabled: previous.spendingEnabled, dailyCreditLimit: previous.dailyCreditLimit,
      perAccountDailyCreditLimit: previous.perAccountDailyCreditLimit,
      maxActiveReservations: previous.maxActiveReservations,
    }, 'genjutsu-test-cleanup');
  }
});
