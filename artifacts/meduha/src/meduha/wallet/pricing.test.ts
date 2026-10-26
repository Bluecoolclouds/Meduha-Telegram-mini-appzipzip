import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_PERIODS, discountPercent, groupBillingPlans, planTierId, priceInRubles } from './pricing.ts';

const plan = (id: string, credits: number, monthlyAmountMinor: number) => ({
  id, name: 'Test', credits, monthlyAmountMinor,
  termPrices: BILLING_PERIODS.map(({ months }) => ({
    months, monthlyAmountMinor, totalAmountMinor: monthlyAmountMinor * months, savingsMinor: 0,
  })),
});

test('wallet groups only plans returned by the server and keeps the exact plan IDs', () => {
  const plans = [
    plan('p100-270', 270, 169100),
    plan('p300-1200', 1200, 525100),
    plan('p1000-3000', 3000, 1148100),
    plan('p1000-6000', 6000, 1958000),
    plan('p1000-9000', 9000, 2759000),
  ];
  const groups = groupBillingPlans(plans);
  assert.deepEqual(groups.map(group => group.id), ['p100', 'p300', 'p1000']);
  assert.deepEqual(groups[2].levels.map(level => level.id), ['p1000-3000', 'p1000-6000', 'p1000-9000']);
  assert.equal(planTierId('p1000-9000'), 'p1000');
  assert.deepEqual(groupBillingPlans([]), []);
});

test('RUB formatting and server-supplied discounts use minor-unit amounts', () => {
  assert.equal(priceInRubles(169100), '1 691 ₽');
  assert.equal(priceInRubles(525100), '5 251 ₽');
  assert.equal(discountPercent(525100, 12, 800400), 13);
  assert.equal(discountPercent(169100, 1, 0), 0);
});

test('all displayed billing terms are the one-, three-, and twelve-month choices', () => {
  assert.deepEqual(BILLING_PERIODS.map(({ months }) => months), [1, 3, 12]);
});
