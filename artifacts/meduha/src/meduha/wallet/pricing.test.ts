import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPUP_PACKAGES, levelOf, resolvePackage, perCredit, usd } from './pricing.ts';

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
