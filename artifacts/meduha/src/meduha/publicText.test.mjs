import assert from 'node:assert/strict';
import test from 'node:test';
import { hideProviderBrand } from './publicText.ts';

test('customer-facing text hides vendor names and source links', () => {
  assert.equal(hideProviderBrand('Работает через Higgsfield'), 'Работает через модель');
  assert.equal(hideProviderBrand('Источник: https://docs.higgsfield.ai/docs/models/genjutsu'), 'Источник: модель');
  assert.equal(hideProviderBrand('Higgs field'), 'модель');
});
