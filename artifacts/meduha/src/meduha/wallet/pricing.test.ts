import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPUP_PACKAGES, BILLING_PERIODS, billingQuote, levelOf, resolvePackage, perCredit, usd } from './pricing.ts';

test('monthly reference prices are explicit USD amounts, not annual promotions', () => {
  assert.deepEqual(TOPUP_PACKAGES.map(t => t.levels), [
    [{ credits: 270, usd: 19 }],
    [{ credits: 1200, usd: 59 }],
    [{ credits: 3000, usd: 129 }, { credits: 6000, usd: 220 }, { credits: 9000, usd: 310 }],
  ]);
});

test('Ultra selection resolves its exact volume price and preserves lower cost per credit', () => {
  const ultra = TOPUP_PACKAGES[2];
  assert.equal(resolvePackage(ultra, {}).usd, 129);
  assert.equal(resolvePackage(ultra, { [ultra.id]: 1 }).usd, 220);
  assert.deepEqual(resolvePackage(ultra, { [ultra.id]: 2 }), { id: ultra.id, note: undefined, credits: 9000, usd: 310 });
  assert.ok(220 / 6000 < 129 / 3000);
  assert.ok(310 / 9000 < 220 / 6000);
});

test('invalid selections cannot create missing or invented price levels', () => {
  const ultra = TOPUP_PACKAGES[2];
  assert.equal(levelOf(ultra, { [ultra.id]: -1 }), 0);
  assert.equal(levelOf(ultra, { [ultra.id]: 99 }), 2);
  assert.equal(levelOf(ultra, { [ultra.id]: NaN }), 0);
  assert.equal(levelOf(ultra, { [ultra.id]: 0.5 }), 0);
  assert.equal(resolvePackage(TOPUP_PACKAGES[1], { p300: 2 }).usd, 59);
});

test('USD and price-per-credit retain useful precision', () => {
  assert.equal(usd(129), '$129');
  assert.equal(perCredit(resolvePackage(TOPUP_PACKAGES[2], {})), '$0,0430');
});

test('verified annual base prices and quarterly half-discounts', () => {
  const [starter, plus, ultra] = TOPUP_PACKAGES.map(t => resolvePackage(t, {}));
  assert.equal(billingQuote(starter, 12).monthlyUsd, 19);
  assert.equal(billingQuote(starter, 3).discount, 0);
  assert.equal(billingQuote(plus, 12).monthlyUsd, 47);
  assert.equal(billingQuote(plus, 3).monthlyUsd, 53);
  assert.equal(billingQuote(ultra, 12).monthlyUsd, 99);
  assert.equal(billingQuote(ultra, 3).monthlyUsd, 114);
  assert.equal(billingQuote(plus, 12).totalUsd, 564);
  assert.equal(billingQuote(plus, 3).totalUsd, 159);
  assert.equal(billingQuote(ultra, 12).totalUsd, 1188);
  assert.equal(billingQuote(ultra, 3).totalUsd, 342);
});

test('all term-volume combinations reconcile to cents and preserve monthly credit quota', () => {
  for (const tier of TOPUP_PACKAGES) for (const [index, level] of tier.levels.entries()) {
    const pkg = resolvePackage(tier, { [tier.id]: index });
    for (const { months } of BILLING_PERIODS) {
      const q = billingQuote(pkg, months);
      assert.equal(pkg.credits, level.credits);
      assert.equal(Math.round(q.totalUsd * 100), Math.round(q.monthlyUsd * 100) * months);
      assert.equal(Math.round((q.totalUsd + q.savingsUsd) * 100), level.usd * months * 100);
      assert.equal(q.discount, months === 1 ? 0 : billingQuote(pkg, 12).discount * (months === 3 ? 0.5 : 1));
      assert.equal(q.volumeCalculated, pkg.id === 'p1000' && index > 0 && months !== 1);
    }
  }
});

test('larger Ultra volumes apply disclosed base-tier discount, with cent rounding', () => {
  const ultra = TOPUP_PACKAGES[2];
  assert.equal(billingQuote(resolvePackage(ultra, { p1000: 1 }), 12).monthlyUsd, 168.84);
  assert.equal(billingQuote(resolvePackage(ultra, { p1000: 2 }), 3).monthlyUsd, 273.95);
});
