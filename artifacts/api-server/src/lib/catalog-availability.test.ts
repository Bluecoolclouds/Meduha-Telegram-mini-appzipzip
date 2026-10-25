import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogAvailabilityIssues } from './catalog-availability';

const configured = { modelId: 'fixture', enabled: true, channelEnabled: true, priceReady: true };
test('catalog readiness separates missing price, model activation and channel activation', () => {
  assert.deepEqual(catalogAvailabilityIssues(configured), []);
  assert.deepEqual(catalogAvailabilityIssues({ ...configured, priceReady: false }), ['Цена режима ещё не настроена.']);
  assert.deepEqual(catalogAvailabilityIssues({ ...configured, enabled: false }), ['Модель выключена администратором.']);
  assert.deepEqual(catalogAvailabilityIssues({ ...configured, channelEnabled: false }), ['Канал генерации выключен администратором.']);
  assert.equal(catalogAvailabilityIssues({ ...configured, priceReady: false, enabled: false, channelEnabled: false }).length, 3);
});
test('unverified tariffs remain blocked even with a positive administrative base price', () => {
  assert.deepEqual(catalogAvailabilityIssues({ ...configured, pricingBlockedReason: 'Нет проверенного максимума.' }), ['Нет проверенного максимума.']);
  assert.deepEqual(catalogAvailabilityIssues({ priceReady: false }), ['Цена режима ещё не настроена.', 'Модель ещё не настроена в студии.']);
});
