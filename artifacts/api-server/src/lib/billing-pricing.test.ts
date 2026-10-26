import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_CURRENCY, getBillingPlans, resolveBillingPlan, USD_TO_RUB_REFERENCE_RATE } from './billing-pricing';

test('billing catalog freezes the user-approved monthly RUB price list at 89 per reference USD', () => {
  assert.equal(BILLING_CURRENCY, 'RUB');
  assert.equal(USD_TO_RUB_REFERENCE_RATE, 89);
  assert.deepEqual(getBillingPlans().map(plan => plan.monthlyAmountRub), [1691, 5251, 11481, 19580, 27590]);
});

test('prepaid terms charge once and schedule the same monthly credit amount', () => {
  const annual = resolveBillingPlan('p1000-9000', 12);
  const threeMonths = resolveBillingPlan('p300-1200', 3);
  assert(annual);
  assert(threeMonths);
  assert.equal(annual.totalAmountMinor, annual.monthlyAmountMinor * 12);
  assert.equal(threeMonths.totalAmountMinor, threeMonths.monthlyAmountMinor * 3);
  assert.equal(annual.credits, 9000);
  assert.equal(resolveBillingPlan('p100-270', 2), null);
});
