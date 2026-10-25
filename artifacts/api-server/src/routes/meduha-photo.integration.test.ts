import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '@workspace/db';
import { createPhotoRouter } from './meduha-photo';
import { publicJob } from './meduha-generations';
import { validatePhotoInput, PhotoInputError, stablePhotoInput, type PhotoMetadata, photoModels } from '../lib/photo';
import { checkPhotoHeader, PhotoResultValidationError } from '../lib/photo-storage';
import { runGenerationWorkerOnce } from '../lib/generation-worker';
import { getFinanceSettings, getWallet, updateFinanceSettings } from '../lib/finance';
import { assertPhotoQuote, photoEstimateMicros, photoPricingFingerprint, photoQuotedPrice, photoRequestHash, PhotoPricingError, signPhotoQuote, verifyPhotoQuote } from '../lib/photo-pricing';

process.env.SESSION_SECRET ??= randomUUID();

test('photo quotes use exact decimal totals, verified ceilings and signed request bindings', () => {
  const metadata: PhotoMetadata = { catalogId: 'higgsfield-ai/soul/standard', endpoint: 'higgsfield-ai/soul/standard', parameters: { prompt: 'Portrait', batch_size: 4 }, references: {} };
  assert.equal(photoEstimateMicros('0.750000'), 750000);
  for (const bad of [0.75, 'NaN', '-1', '0', '1e-2', '0.0000001', null]) assert.throws(() => photoEstimateMicros(bad), PhotoPricingError);
  assert.equal(photoQuotedPrice(15, metadata, 750000), 60);
  assert.equal(photoQuotedPrice(15, metadata, 375200), 31);
  assert.throws(() => photoQuotedPrice(15, metadata, 750001), PhotoPricingError);
  assert.throws(() => photoQuotedPrice(7, { ...metadata, catalogId: 'workflows/ads-studio', endpoint: 'higgsfield/ads-studio/v1.0' }, 84000), PhotoPricingError);
  assert.throws(() => photoQuotedPrice(7, { ...metadata, endpoint: 'unknown' }, 84000), PhotoPricingError);
  const claims = { purpose: 'photo-price' as const, accountId: 'fixture', modelId: randomUUID(), idempotencyKey: randomUUID(), requestHash: photoRequestHash(metadata), pricingFingerprint: photoPricingFingerprint(15), creditPrice: 60, expiresAt: Date.now() + 60_000, usdMicros: 750000 };
  const token = signPhotoQuote(claims);
  assert.deepEqual(verifyPhotoQuote(token), claims);
  assert.throws(() => verifyPhotoQuote(`${token}x`), PhotoPricingError);
  assert.throws(() => verifyPhotoQuote(signPhotoQuote({ ...claims, expiresAt: Date.now() - 1 })), PhotoPricingError);
  assertPhotoQuote(claims, 'fixture', claims.modelId, claims.idempotencyKey, metadata, 60);
  for (const changed of [
    { ...metadata, parameters: { ...metadata.parameters, resolution: '1080p' } },
    { ...metadata, parameters: { ...metadata.parameters, quality: 'high' } },
    { ...metadata, references: { image_url: [randomUUID()] } },
  ]) assert.throws(() => assertPhotoQuote(claims, 'fixture', claims.modelId, claims.idempotencyKey, changed, 60), PhotoPricingError);
  assert.throws(() => assertPhotoQuote(claims, 'other', claims.modelId, claims.idempotencyKey, metadata, 60), PhotoPricingError);
  assert.throws(() => assertPhotoQuote(claims, 'fixture', claims.modelId, randomUUID(), metadata, 60), PhotoPricingError);
});

test('official photo schemas reject unsupported inputs, invalid references and workflow shortcuts', () => {
  const base: PhotoMetadata = { catalogId: 'higgsfield-ai/soul/standard', endpoint: 'higgsfield-ai/soul/standard', parameters: { prompt: 'Portrait', resolution: '720p' }, references: {} };
  assert.equal(validatePhotoInput(base).prompt, 'Portrait');
  for (const parameters of [{ prompt: '' }, { prompt: 'hi', resolution: '4k' }, { prompt: 'hi', batch_size: 2 }, { prompt: 'hi', random_option: true }]) {
    assert.throws(() => validatePhotoInput({ ...base, parameters }), PhotoInputError);
  }
  assert.throws(() => validatePhotoInput({ ...base, references: { image_url: [randomUUID()] } }), PhotoInputError);
  const image = { ...base, catalogId: 'higgsfield-ai/soul/v2/image-to-image', endpoint: 'higgsfield-ai/soul/v2/image-to-image' };
  assert.throws(() => validatePhotoInput(image), PhotoInputError);
  assert.throws(() => validatePhotoInput({ ...image, parameters: { prompt: 'hi', image_url: 'https://attacker.test/x' } }), PhotoInputError);
  assert.throws(() => validatePhotoInput({ ...image, parameters: { prompt: 'hi', enhance_prompt: false }, references: { image_url: [randomUUID()] } }), PhotoInputError);
  assert.equal(validatePhotoInput({ ...image, references: { image_url: [randomUUID()] } }).prompt, 'Portrait');
  const workflow = photoModels.find(m => m.id === 'workflows/product-shots')!;
  const workflowMeta = { ...base, catalogId: workflow.id, endpoint: workflow.endpoint };
  assert.throws(() => validatePhotoInput(workflowMeta), PhotoInputError);
  assert.equal(validatePhotoInput({
    ...workflowMeta, parameters: { prompt: 'product', quality: 'high', enhance_prompt: true, preset_id: (workflow.schema.properties as any).preset_id.default },
    references: { image_urls: [randomUUID()] },
  }).quality, 'high');
  assert.equal(stablePhotoInput({ a: { x: 1, y: 2 }, b: 3 }), stablePhotoInput({ b: 3, a: { y: 2, x: 1 } }));
  assert.throws(() => checkPhotoHeader('image/png', Buffer.from('<html>not an image</html>')), PhotoResultValidationError);
  checkPhotoHeader('image/png', Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]));
});

test('private photo lifecycle: auth, schema, batch credit holds, replay, completion, rejection and lost submission', async () => {
  const accountId = `photo-fixture-${randomUUID()}`, otherId = `photo-other-${randomUUID()}`;
  const channelId = randomUUID(), modelId = randomUUID(), token = createHash('sha256').update(randomUUID()).digest('hex');
  const originalSettings = await pool.query(`SELECT * FROM meduha_finance_settings WHERE id=1`);
  const previous = await getFinanceSettings();
  const app = express();
  let estimates = 0;
  let estimateFails = false;
  app.use(express.json(), cookieParser());
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} } as any; next(); });
  app.use('/api/meduha', createPhotoRouter({
    providerConfigured: () => true, storageConfigured: () => true,
    // Tests never contact the paid service or object storage.
    providerInput: async (_account, metadata) => metadata.parameters,
    estimate: async (_endpoint, input) => {
      estimates++;
      if (estimateFails) throw new PhotoPricingError('QUOTE_UNAVAILABLE', 'Fixture unavailable', 503);
      return Math.round((input.resolution === '720p' ? 93800 : 187500) * Number(input.batch_size ?? 1));
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}/api/meduha`;
  const call = (body: object, authenticated = true) => fetch(`${origin}/photo/generations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `meduha_session=${token}` } : {}) }, body: JSON.stringify(body),
  });
  const quote = (body: object, authenticated = true) => fetch(`${origin}/photo/quote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `meduha_session=${token}` } : {}) }, body: JSON.stringify(body),
  });
  const withQuote = async <T extends Record<string, any>>(body: T) => {
    const response = await quote(body);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as { token: string; creditPrice: number };
    return { ...body, expectedCreditPrice: result.creditPrice, priceQuote: result.token };
  };
  try {
    await pool.query(`INSERT INTO meduha_accounts (id,first_name,credits) VALUES ($1,'Photo fixture',200),($2,'Other photo fixture',0)`, [accountId, otherId]);
    await pool.query(`INSERT INTO meduha_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [createHash('sha256').update(token).digest('hex'), accountId]);
    await pool.query(`INSERT INTO meduha_ai_channels (id,name,base_url,adapter,enabled,concurrency_limit,daily_credit_limit) VALUES ($1,'Photo fixture','https://api.higgsfield.ai','higgsfield',true,10,10000)`, [channelId]);
    await pool.query(`INSERT INTO meduha_ai_models (id,channel_id,upstream_id,display_name,kind,enabled,credit_price,limits) VALUES ($1,$2,'higgsfield-ai/soul/standard','Soul fixture','photo',true,5,'{"concurrencyLimit":10,"dailyCreditLimit":10000}')`, [modelId, channelId]);
    await updateFinanceSettings({ spendingEnabled: true, dailyCreditLimit: 10000, maxActiveReservations: 20 }, 'photo-test');
    const request = { idempotencyKey: randomUUID(), catalogId: 'higgsfield-ai/soul/standard', modelId, parameters: { prompt: 'Portrait', batch_size: 4, resolution: '1080p' }, references: {} };
    assert.equal((await quote(request, false)).status, 401);
    assert.equal((await call({ ...request, expectedCreditPrice: 20 })).status, 400, 'no launch without an explicit signed quote');
    estimateFails = true;
    assert.equal((await quote(request)).status, 503);
    estimateFails = false;
    const body = await withQuote(request);
    assert.equal(body.expectedCreditPrice, 20);
    assert.equal((await getWallet(accountId)).reserved, 0, 'estimate reserves nothing');
    assert.equal(Number((await pool.query(`SELECT count(*) FROM meduha_generation_jobs WHERE account_id=$1`, [accountId])).rows[0].count), 0, 'estimate never queues a job');
    const low = await withQuote({ ...request, idempotencyKey: randomUUID(), parameters: { ...request.parameters, resolution: '720p' } });
    assert.equal(low.expectedCreditPrice, 11, 'resolution changes the actual total');
    const beforeBlocked = estimates;
    assert.equal((await quote({ ...request, catalogId: 'workflows/ads-studio', parameters: { prompt: 'ad', batch_size: 8 } })).status, 409);
    assert.equal(estimates, beforeBlocked, 'unbounded Ads Studio is rejected before provider access');
    const expired = signPhotoQuote({ ...verifyPhotoQuote(body.priceQuote), expiresAt: Date.now() - 1 });
    assert.equal((await call({ ...body, priceQuote: expired })).status, 409);
    await pool.query(`UPDATE meduha_ai_models SET credit_price=6 WHERE id=$1`, [modelId]);
    assert.equal((await call(body)).status, 409, 'tariff changes invalidate quotes');
    await pool.query(`UPDATE meduha_ai_models SET credit_price=5 WHERE id=$1`, [modelId]);
    assert.equal((await call(body, false)).status, 401);
    assert.equal((await call({ ...body, parameters: { prompt: 'hi', batch_size: 2 } })).status, 400);
    assert.equal((await call({ ...body, expectedCreditPrice: 1 })).status, 409, 'price drift cannot charge more than the user confirmed');
    const responses = await Promise.all([call(body), call(body)]);
    assert.deepEqual(responses.map(r => r.status), [202,202], await responses[0].clone().text());
    const accepted = await Promise.all(responses.map(r => r.json())) as { job: { id: string; creditPrice: number } }[];
    assert.equal(accepted[0].job.id, accepted[1].job.id);
    assert.equal(accepted[0].job.creditPrice, 20);
    assert.equal((await getWallet(accountId)).reserved, 20);
    assert.equal((await call({ ...body, parameters: { prompt: 'Different', batch_size: 4 } })).status, 409);
    let submits = 0, stored = 0;
    await runGenerationWorkerOnce({
      submit: async input => { submits++; assert.equal(input._photo?.endpoint, body.catalogId); return { request_id: randomUUID(), status: 'completed', images: Array.from({ length: 4 }, (_, i) => ({ url: `https://fixtures.invalid/${i}.png` })) }; },
      storeImages: async (id, urls) => { stored++; assert.equal(urls.length, 4); return urls.map((_, i) => `/api/meduha/generations/${id}/images/${i}`); },
      getStatus: async () => { throw new Error('No polling expected'); },
    });
    assert.equal(submits, 1); assert.equal(stored, 1);
    assert.equal((await getWallet(accountId)).balance, 180);
    assert.equal((await getWallet(accountId)).reserved, 0);
    const saved = await pool.query(`SELECT j.*,m.display_name FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id=j.model_id WHERE j.id=$1`, [accepted[0].job.id]);
    const output = publicJob(saved.rows[0]);
    assert.equal(output.mediaKind, 'photo'); assert.equal(output.resultUrls.length, 4);
    assert.equal(JSON.stringify(output).includes('fixtures.invalid'), false);
    assert.equal((await call(body)).status, 202);
    assert.equal((await getWallet(accountId)).balance, 180);
    const privatePath = output.resultUrls[0];
    assert.equal((await fetch(`http://127.0.0.1:${address.port}${privatePath}`)).status, 401);
    await pool.query(`UPDATE meduha_sessions SET user_id=$2 WHERE token_hash=$1`, [createHash('sha256').update(token).digest('hex'), otherId]);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}${privatePath}`, { headers: { Cookie: `meduha_session=${token}` } })).status, 404);
    await pool.query(`UPDATE meduha_sessions SET user_id=$2 WHERE token_hash=$1`, [createHash('sha256').update(token).digest('hex'), accountId]);
    assert.equal((await call(await withQuote({ ...request, idempotencyKey: randomUUID(), parameters: { prompt: 'Failure case' } }))).status, 202);
    await runGenerationWorkerOnce({
      submit: async () => ({ request_id: randomUUID(), status: 'completed', images: [{ url: 'https://fixtures.invalid/bad.png' }] }),
      storeImages: async () => { throw new PhotoResultValidationError('invalid image'); },
      getStatus: async () => ({ status: 'queued' }),
    });
    assert.equal((await getWallet(accountId)).balance, 180); assert.equal((await getWallet(accountId)).reserved, 0);
    const lost = await withQuote({ ...request, idempotencyKey: randomUUID(), parameters: { prompt: 'Lost response' } });
    assert.equal((await call(lost)).status, 202);
    await runGenerationWorkerOnce({ submit: async () => { throw new Error('lost response'); } });
    await runGenerationWorkerOnce({ submit: async () => { assert.fail('must not retry billable POST'); } });
    assert.equal((await getWallet(accountId)).reserved, 5);
    assert.equal((await call(lost)).status, 202);
    await updateFinanceSettings({ spendingEnabled: false }, 'photo-test');
    assert.equal((await call({ ...body, idempotencyKey: randomUUID() })).status, 409);
  } finally {
    // Restore safety settings before fixture cleanup, even when cleanup fails.
    const row = originalSettings.rows[0];
    if (row) {
      await pool.query(`UPDATE meduha_finance_settings SET spending_enabled=$1,daily_credit_limit=$2,max_active_reservations=$3,updated_by=$4,updated_at=$5 WHERE id=1 AND updated_by='photo-test'`, [row.spending_enabled,row.daily_credit_limit,row.max_active_reservations,row.updated_by,row.updated_at]);
    } else await updateFinanceSettings(previous, 'photo-test-cleanup');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.query(`DELETE FROM meduha_generation_jobs WHERE account_id=ANY($1::text[])`, [[accountId,otherId]]);
    await pool.query(`DELETE FROM meduha_finance_idempotency WHERE reservation_id IN (SELECT id FROM meduha_credit_reservations WHERE account_id=ANY($1::text[]))`, [[accountId,otherId]]);
    await pool.query(`DELETE FROM meduha_finance_ledger WHERE account_id=ANY($1::text[])`, [[accountId,otherId]]);
    await pool.query(`DELETE FROM meduha_credit_reservations WHERE account_id=ANY($1::text[])`, [[accountId,otherId]]);
    await pool.query(`DELETE FROM meduha_accounts WHERE id=ANY($1::text[])`, [[accountId,otherId]]);
    await pool.query(`DELETE FROM meduha_ai_models WHERE id=$1`, [modelId]);
    await pool.query(`DELETE FROM meduha_ai_channels WHERE id=$1`, [channelId]);
  }
});
test.after(async () => { await pool.end(); });
