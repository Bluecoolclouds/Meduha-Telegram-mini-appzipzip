import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from './photo-catalog.json';
import { catalogAvailabilityIssues } from './catalog-availability';
import { estimatePhotoRequest, photoEstimateMicros, photoPricingBlockedReason, photoQuotedPrice, PhotoPricingError } from './photo-pricing';

const tokenEndpoints = [
  'higgsfield/ads-studio/v1.0',
  'marketing-studio/image/flare',
  'marketing-studio/image/sunburst',
];

test('token models stay visible but cannot be quoted or launched even with a configured price', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network access'); };
  try {
    for (const endpoint of tokenEndpoints) {
      const model = catalog.models.find(model => model.endpoint === endpoint);
      assert.ok(model, 'keep installed models in the catalog');
      const reason = photoPricingBlockedReason(endpoint);
      assert.match(reason ?? '', /конкретного запроса/);
      assert.ok(catalogAvailabilityIssues({
        modelId: 'fixture', enabled: true, channelEnabled: true, priceReady: true,
        pricingBlockedReason: reason,
      }).length > 0, 'activation and a manual price cannot bypass the pricing block');
      assert.throws(() => photoQuotedPrice(55, {
        catalogId: model.id, endpoint, parameters: { batch_size: 1 }, references: {},
      }, 84000), PhotoPricingError, 'even a numeric quote cannot bypass the block');
      await assert.rejects(estimatePhotoRequest(endpoint, { prompt: 'Fixture' }),
        (error: unknown) => error instanceof PhotoPricingError && error.code === 'UNSAFE_PHOTO_PRICE');
    }
    assert.equal(calls, 0, 'blocked models are rejected before any provider call');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('descriptive pricing is not zero, a numeric estimate or a final charge', () => {
  const response = {
    type: 'description',
    pricing_description: 'Final cost uses actual token usage. The initial charge is an estimate reconciled on completion.',
  };
  for (const value of [undefined, response, response.pricing_description, null, '0', 0.084]) {
    assert.throws(() => photoEstimateMicros(value), PhotoPricingError);
  }
  assert.equal(photoEstimateMicros('0.094'), 94000);
});

test('verified fixed-reference models retain their existing quote calculation', () => {
  assert.equal(photoPricingBlockedReason('higgsfield-ai/soul/standard'), null);
  assert.equal(photoQuotedPrice(15, {
    catalogId: 'higgsfield-ai/soul/standard', endpoint: 'higgsfield-ai/soul/standard',
    parameters: { batch_size: 1 }, references: {},
  }, 94000), 8);
  for (const endpoint of tokenEndpoints) {
    assert.equal(Object.hasOwn(catalog.pricing.referenceMaxUsdMicros, endpoint), false,
      'token models have no invented fixed maximum');
  }
});
