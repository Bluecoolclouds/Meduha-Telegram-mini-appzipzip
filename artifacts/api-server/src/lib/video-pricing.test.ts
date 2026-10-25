import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assertVideoQuote, seedancePricingEndpoints, klingPricingEndpoints, signVideoQuote, verifyVideoQuote, estimateVideoRequest,
  videoPricingFingerprint, videoPricingPolicy, videoQuotedPrice, videoRequestHash,
} from './video-pricing';
import { videoPriceReference } from './video-price-reference';
import { validateVideoInput, type VideoMetadata } from './video';

const endpoint = 'bytedance/seedance-2.5/text-to-video';
const settings = { videoCreditsPerUsd: 100, videoMaxUsd: 20 };
const policy = videoPricingPolicy(endpoint, settings)!;
const metadata: VideoMetadata = { catalogId: endpoint, endpoint, parameters: { prompt: 'Fixture', duration: 5, resolution: '720p' }, references: {} };

test('video pricing is opt-in and only valid for all five documented Seedance 2.5 modes', () => {
  assert.equal(videoPricingPolicy(endpoint, {}), null);
  for (const id of seedancePricingEndpoints) assert.deepEqual(videoPricingPolicy(id, settings), policy);
  const invalidLimits: Record<string, number>[] = [
    { videoCreditsPerUsd: 0, videoMaxUsd: 20 },
    { videoCreditsPerUsd: 0.5, videoMaxUsd: 20 },
    { videoCreditsPerUsd: 1, videoMaxUsd: 0 },
    { videoCreditsPerUsd: 1, videoMaxUsd: 0.0000001 },
    { videoCreditsPerUsd: 1, videoMaxUsd: NaN },
    { videoCreditsPerUsd: 1000000, videoMaxUsd: 10000 },
    { videoCreditsPerUsd: 100 },
    { videoMaxUsd: 20 },
  ];
  for (const bad of invalidLimits) {
    assert.throws(() => videoPricingPolicy(endpoint, bad));
  }
  assert.throws(() => videoPricingPolicy('kling-video/v4.0/text-to-video', settings));
});
test('USD conversion rounds up and fails closed at the exact configured ceiling', () => {
  assert.equal(videoQuotedPrice(policy, 1), 1);
  assert.equal(videoQuotedPrice(policy, 1_000_000), 100);
  assert.equal(videoQuotedPrice(policy, 1_000_001), 101);
  assert.equal(videoQuotedPrice(policy, 20_000_000), 2000);
  for (const value of [0, -1, 0.1, NaN, Infinity, 20_000_001]) assert.throws(() => videoQuotedPrice(policy, value));
});
test('Kling Standard modes opt into account-specific estimation without overriding fixed prices', () => {
  for (const id of klingPricingEndpoints) {
    assert.equal(videoPricingPolicy(id, {}), null);
    assert.deepEqual(videoPricingPolicy(id, settings), policy);
    assert.equal(videoQuotedPrice(videoPricingPolicy(id, settings)!, 420_001), 43);
    assert.throws(() => videoPricingPolicy(id, { videoCreditsPerUsd: 100 }));
  }
  assert.throws(() => videoPricingPolicy('kling-video/v3.0/pro/text-to-video', settings));
  assert.equal(videoPriceReference.klingRates.length, 2);
  assert.equal(videoPriceReference.klingRates[0].usdPerSecondMin, 0.084);
  assert.equal(videoPriceReference.klingRates[1].usdPerSecondMax, 0.126);
});
test('Kling quote signatures bind sound, duration, multiple shots, mode and source images', () => {
  const request: VideoMetadata = { catalogId: 'kling-video/v3.0/std/text-to-video', endpoint: 'kling-video/v3.0/std/text-to-video',
    parameters: { prompt: 'Synthetic', duration: 5, sound: 'on', multi_shots: false, aspect_ratio: '16:9' }, references: {} };
  const claims = { purpose: 'video-price' as const, accountId: randomUUID(), modelId: randomUUID(), idempotencyKey: randomUUID(),
    requestHash: videoRequestHash(request), pricingFingerprint: videoPricingFingerprint(policy),
    usdMicros: 420_000, creditPrice: 42, expiresAt: Date.now() + 60_000 };
  assertVideoQuote(verifyVideoQuote(signVideoQuote(claims)), claims.accountId, claims.modelId, claims.idempotencyKey, request, policy, 42);
  for (const patch of [{ duration: 15 }, { sound: 'off' }, { multi_shots: true }, { aspect_ratio: '9:16' }]) {
    assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey,
      { ...request, parameters: { ...request.parameters, ...patch } }, policy, 42));
  }
  assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey,
    { ...request, endpoint: 'kling-video/v3.0/std/image-to-video', references: { '/image_url': [randomUUID()] } }, policy, 42));
});
test('Kling Standard follows the documented 3–15 second schema, not the one-second pricing example', () => {
  const request: VideoMetadata = { catalogId: 'kling-video/v3.0/std/text-to-video', endpoint: 'kling-video/v3.0/std/text-to-video',
    parameters: { prompt: 'Synthetic only', duration: 5, sound: 'on', aspect_ratio: '16:9' }, references: {} };
  for (const duration of [3, 5, 15]) assert.doesNotThrow(() => validateVideoInput({ ...request, parameters: { ...request.parameters, duration } }));
  for (const duration of [1, 2, 16, 5.5]) assert.throws(() => validateVideoInput({ ...request, parameters: { ...request.parameters, duration } }));
});
test('Kling estimation calls only the estimate endpoint and never falls back to generation', async (t) => {
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.higgsfield.ai/estimate/kling-video/v3.0/std/text-to-video');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init.body)), { prompt: 'Synthetic only', duration: 5, sound: 'off' });
    return Response.json({ usd: '0.420001' });
  });
  const parameters = { prompt: 'Synthetic only', duration: 5, sound: 'off' };
  assert.equal(await estimateVideoRequest('kling-video/v3.0/std/text-to-video', parameters), 420001);
  fetchMock.mock.mockImplementation(async () => { calls++; return new Response('', { status: 503 }); });
  await assert.rejects(estimateVideoRequest('kling-video/v3.0/std/text-to-video', parameters), { code: 'QUOTE_UNAVAILABLE' });
  assert.equal(calls, 2);
  await assert.rejects(estimateVideoRequest('kling-video/v3.0/pro/text-to-video', parameters), { code: 'MODEL_NOT_PRICED' });
  assert.equal(calls, 2, 'unsupported models issue no request at all');
});
test('request fingerprints bind duration, resolution, audio, aspect and owned references', () => {
  const original = videoRequestHash(metadata);
  for (const patch of [{ duration: 6 }, { resolution: '1080p' }, { generate_audio: false }, { aspect_ratio: '9:16' }]) {
    assert.notEqual(videoRequestHash({ ...metadata, parameters: { ...metadata.parameters, ...patch } }), original);
  }
  assert.notEqual(videoRequestHash({ ...metadata, references: { '/image_url': [randomUUID()] } }), original);
  assert.notEqual(videoPricingFingerprint(policy), videoPricingFingerprint({ ...policy, creditsPerUsd: 101 }));
  assert.notEqual(videoPricingFingerprint(policy), videoPricingFingerprint({ ...policy, maxUsdMicros: 21_000_000 }));
});
test('a signed quote cannot be changed, reused by another account, request, key or tariff', () => {
  const claims = {
    purpose: 'video-price' as const, accountId: randomUUID(), modelId: randomUUID(), idempotencyKey: randomUUID(),
    requestHash: videoRequestHash(metadata), pricingFingerprint: videoPricingFingerprint(policy),
    usdMicros: 123_001, creditPrice: 13, expiresAt: Date.now() + 60_000,
  };
  const token = signVideoQuote(claims);
  assert.deepEqual(verifyVideoQuote(token), claims);
  assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey, metadata, policy, 13);
  assert.throws(() => verifyVideoQuote(`${token}x`));
  assert.throws(() => verifyVideoQuote(signVideoQuote({ ...claims, expiresAt: Date.now() - 1 })));
  assert.throws(() => assertVideoQuote(claims, randomUUID(), claims.modelId, claims.idempotencyKey, metadata, policy, 13));
  assert.throws(() => assertVideoQuote(claims, claims.accountId, randomUUID(), claims.idempotencyKey, metadata, policy, 13));
  assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, randomUUID(), metadata, policy, 13));
  assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey, { ...metadata, references: { '/video_url': [randomUUID()] } }, policy, 13));
  assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey, metadata, { ...policy, creditsPerUsd: 101 }, 13));
  assert.throws(() => assertVideoQuote(claims, claims.accountId, claims.modelId, claims.idempotencyKey, metadata, policy, 12));
});
test('reference rates distinguish input-video token billing and approximate restyle prices', () => {
  assert.equal(videoPriceReference.seedanceRates.length, 6);
  assert.equal(videoPriceReference.seedanceRates.find(r => r.resolution === '1080p' && r.videoInput)?.usdPer1000Tokens, 0.01404);
  assert.equal(videoPriceReference.genjutsuRates.length, 9);
  assert(videoPriceReference.genjutsuRates.filter(r => r.scenario === 'restyle').every(r => !r.exact));
});
