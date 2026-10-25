import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '@workspace/db';
import { createVideoRouter } from './meduha-video';
import { publicJob } from './meduha-generations';
import { videoModels, videoFamilies, validateVideoInput, videoFileFields, VideoInputError, type VideoMetadata } from '../lib/video';
import { hasDocumentSignature, DOCUMENT_TYPES } from '../lib/document-files';
import { runGenerationWorkerOnce } from '../lib/generation-worker';
import { getWallet, updateFinanceSettings } from '../lib/finance';

test('official video catalogue covers every family and Seedance 2.5 mode without guessed endpoints', () => {
  assert.equal(videoFamilies.length, 24);
  assert.equal(videoModels.length, 75);
  assert.equal(new Set(videoModels.map(m => m.id)).size, 75);
  for (const family of videoFamilies) for (const id of family.modes) {
    const model = videoModels.find(m => m.id === id);
    assert(model && model.endpoint && model.schema.properties);
    assert.equal(model.familyId, family.id);
    assert.equal(model.source, `https://open.higgsfield.ai/models/${id}/playground`);
  }
  assert.equal(videoFamilies[0].modes.length, 5);
  for (const suffix of ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'video-extend']) {
    assert(videoFamilies[0].modes.includes(`bytedance/seedance-2.5/${suffix}`));
  }
});
test('video input schemas enforce modes, required references, URL ownership path and exact parameters', () => {
  const base: VideoMetadata = { catalogId: 'bytedance/seedance-2.5/text-to-video', endpoint: 'bytedance/seedance-2.5/text-to-video',
    parameters: { prompt: 'A mountain', duration: 5, resolution: '1080p', output_format: 'mov', generate_audio: false }, references: {} };
  assert.equal(validateVideoInput(base).output_format, 'mov');
  for (const parameters of [{ prompt: '' }, { prompt: 'hi', duration: 31 }, { prompt: 'hi', resolution: '4k' }, { prompt: 'hi', invented: true }]) {
    assert.throws(() => validateVideoInput({ ...base, parameters }), VideoInputError);
  }
  const image = { ...base, catalogId: 'bytedance/seedance-2.5/image-to-video', endpoint: 'bytedance/seedance-2.5/image-to-video', parameters: { prompt: 'A mountain', duration: 5 } };
  assert.throws(() => validateVideoInput(image), VideoInputError);
  assert.throws(() => validateVideoInput({ ...image, parameters: { ...base.parameters, image_url: 'https://unowned.invalid/photo.jpg' } }), VideoInputError);
  assert.equal(validateVideoInput({ ...image, references: { '/image_url': [randomUUID()] } }).image_url, 'https://reference.example/input');
  assert.throws(() => validateVideoInput({ ...image, references: { '/video_url': [randomUUID()] } }), VideoInputError);
  assert.throws(() => validateVideoInput({ ...image, references: { '/image_url': [randomUUID(), randomUUID()] } }), VideoInputError);
  assert.throws(() => validateVideoInput({ ...image, references: { '/image_url': [randomUUID()], image_url: [randomUUID()] } }), VideoInputError);
  assert.throws(() => validateVideoInput({ ...image, references: { '/__proto__/image_url': [randomUUID()] } }), VideoInputError);
  const document = videoModels.find(m => m.id === 'alibaba/wan-3.0/reference-to-video')!;
  assert(videoFileFields(document).some(f => f.path === '/file_url' && f.kind === 'document'));
  assert(!videoFileFields(document).some(f => f.path === '/link_url'));
  const withElements = videoModels.find(m => m.schema.properties?.elements)!;
  assert.throws(() => validateVideoInput({ catalogId: withElements.id, endpoint: withElements.endpoint,
    parameters: { prompt: 'A scene', elements: [1] }, references: {} }), /не привязаны/);
  for (const id of ['alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0-prime/reference-to-video']) {
    const m = videoModels.find(m => m.id === id)!;
    const doc: VideoMetadata = { catalogId: id, endpoint: m.endpoint, parameters: { prompt: 'A scene', prompt_extend: false }, references: { '/file_url': [randomUUID()] } };
    assert.throws(() => validateVideoInput(doc), VideoInputError);
    assert.equal(validateVideoInput({ ...doc, parameters: { prompt: 'A scene' } }).prompt_extend, true);
    assert.equal(validateVideoInput({ ...doc, references: {}, parameters: { prompt: 'A scene', link_url: 'https://example.com/reference', prompt_extend: true } }).prompt_extend, true);
  }
});
test('private documents reject wrong signatures, binaries and truncated archives without executing contents', () => {
  assert(hasDocumentSignature(Buffer.from('%PDF-1.7\nfixture\n%%EOF'), 'application/pdf'));
  assert(hasDocumentSignature(Buffer.from('# Референс\nОписание'), 'text/markdown'));
  assert(!hasDocumentSignature(Buffer.from([255, 254, 0, 0]), 'text/markdown'));
  assert(!hasDocumentSignature(Buffer.from('<html>no PDF</html>'), 'application/pdf'));
  for (const type of DOCUMENT_TYPES) assert.doesNotThrow(() => hasDocumentSignature(Buffer.from([0]), type));
});
test('video lifecycle reserves once, preserves private output, rejects stale price/ownership and never retries unknown submissions', async () => {
  const accountId = `video-fixture-${randomUUID()}`, channelId = randomUUID(), modelId = randomUUID(), imageModelId = randomUUID();
  const token = createHash('sha256').update(randomUUID()).digest('hex'), hash = createHash('sha256').update(token).digest('hex');
  const original = (await pool.query('SELECT * FROM meduha_finance_settings WHERE id=1')).rows[0];
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} } as any; next(); });
  app.use('/api/meduha', createVideoRouter({ providerConfigured: () => true, storageConfigured: () => true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}/api/meduha`;
  const call = (body: object, auth = true) => fetch(`${origin}/video/generations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: `meduha_session=${token}` } : {}) }, body: JSON.stringify(body),
  });
  try {
    await pool.query(`INSERT INTO meduha_accounts (id,first_name,credits) VALUES ($1,'Video fixture',100)`, [accountId]);
    await pool.query(`INSERT INTO meduha_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [hash, accountId]);
    await pool.query(`INSERT INTO meduha_ai_channels (id,name,base_url,adapter,enabled,concurrency_limit,daily_credit_limit) VALUES ($1,'Video fixture','https://api.higgsfield.ai','higgsfield',true,10,10000)`, [channelId]);
    for (const [id, mode] of [[modelId, 'text-to-video'], [imageModelId, 'image-to-video']]) {
      await pool.query(`INSERT INTO meduha_ai_models (id,channel_id,upstream_id,display_name,kind,enabled,credit_price,limits) VALUES ($1,$2,$3,'Video fixture','video',true,5,'{"concurrencyLimit":10,"dailyCreditLimit":10000}')`, [id, channelId, `bytedance/seedance-2.5/${mode}`]);
    }
    await updateFinanceSettings({ spendingEnabled: true, dailyCreditLimit: 10000, perAccountDailyCreditLimit: 10000, maxActiveReservations: 20 }, 'video-test');
    const body = { idempotencyKey: randomUUID(), catalogId: 'bytedance/seedance-2.5/text-to-video', modelId,
      expectedCreditPrice: 5, parameters: { prompt: 'Video fixture', duration: 5, generate_audio: false }, references: {} };
    assert.equal((await call(body, false)).status, 401);
    assert.equal((await call({ ...body, parameters: { ...body.parameters, duration: 31 } })).status, 400);
    assert.equal((await call({ ...body, expectedCreditPrice: 1 })).status, 409);
    assert.equal((await call({ ...body, catalogId: 'bytedance/seedance-2.5/image-to-video', modelId: imageModelId, references: { '/image_url': [randomUUID()] } })).status, 400, 'unowned files cannot reach the queue');
    const responses = await Promise.all([call(body), call(body)]);
    assert.deepEqual(responses.map(r => r.status), [202, 202], await responses[0].clone().text());
    const jobs = await Promise.all(responses.map(r => r.json())) as any[];
    assert.equal(jobs[0].job.id, jobs[1].job.id);
    assert.equal((await getWallet(accountId)).reserved, 5);
    assert.equal((await call({ ...body, parameters: { ...body.parameters, generate_audio: true } })).status, 409);
    let submits = 0;
    await runGenerationWorkerOnce({
      submit: async input => { submits++; assert.equal(input._video?.catalogId, body.catalogId); assert.equal(input._video?.parameters.generate_audio, false); return { request_id: randomUUID(), status: 'completed', video: { url: 'https://fixtures.invalid/video.mp4' } }; },
      storeVideo: async () => ({ size: 24, contentType: 'video/mp4' }),
      getStatus: async () => { throw new Error('No polling expected'); },
    });
    assert.equal(submits, 1);
    assert.equal((await getWallet(accountId)).balance, 95);
    assert.equal((await getWallet(accountId)).reserved, 0);
    const saved = (await pool.query('SELECT j.*,m.display_name FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id=j.model_id WHERE j.id=$1', [jobs[0].job.id])).rows[0];
    const output = publicJob(saved);
    assert.equal(output.scenario, body.catalogId);
    assert.equal(output.mediaKind, 'video');
    assert.equal(output.resultUrl, `/api/meduha/generations/${output.id}/video`);
    assert(!JSON.stringify(output).includes('fixtures.invalid'));
    assert.equal((await call(body)).status, 202);
    const lost = { ...body, idempotencyKey: randomUUID() };
    assert.equal((await call(lost)).status, 202);
    await runGenerationWorkerOnce({ submit: async () => { throw new Error('lost response'); } });
    await runGenerationWorkerOnce({ submit: async () => { assert.fail('must never repeat a possibly billable submission'); } });
    assert.equal((await getWallet(accountId)).reserved, 5);
    assert.equal((await call(lost)).status, 202);
    await updateFinanceSettings({ spendingEnabled: false }, 'video-test');
    assert.equal((await call({ ...body, idempotencyKey: randomUUID() })).status, 409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    // Restore the shared safety settings first, even if fixture deletion fails.
    if (original) await pool.query(`UPDATE meduha_finance_settings SET spending_enabled=$1,daily_credit_limit=$2,max_active_reservations=$3,updated_by=$4,updated_at=$5,per_account_daily_credit_limit=$6 WHERE id=1 AND updated_by='video-test'`,
      [original.spending_enabled, original.daily_credit_limit, original.max_active_reservations, original.updated_by, original.updated_at, original.per_account_daily_credit_limit]);
    await pool.query('DELETE FROM meduha_generation_jobs WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_finance_idempotency WHERE reservation_id IN (SELECT id FROM meduha_credit_reservations WHERE account_id=$1)', [accountId]);
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_accounts WHERE id=$1', [accountId]);
    await pool.query('DELETE FROM meduha_ai_models WHERE id=ANY($1::text[])', [[modelId, imageModelId]]);
    await pool.query('DELETE FROM meduha_ai_channels WHERE id=$1', [channelId]);
  }
});
test.after(async () => { await pool.end(); });
