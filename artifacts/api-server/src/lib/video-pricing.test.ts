import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assertVideoQuote, seedancePricingEndpoints, signVideoQuote, verifyVideoQuote,
  videoPricingFingerprint, videoPricingPolicy, videoQuotedPrice, videoRequestHash,
} from './video-pricing';
import { videoPriceReference } from './video-price-reference';
import type { VideoMetadata } from './video';

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
