import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeKassaProvider, configuredFreeKassaProvider, FreeKassaNotificationError } from './freekassa';
import { configuredPaymentProvider, paymentsEnabled } from './payment-providers';
import { resolveBillingPlan } from './billing-pricing';

const config = { merchantId: '123', secretWord1: 'fixture-word-one', secretWord2: 'fixture-word-two' };
const orderId = 'c61d4001-0065-4d0f-853a-11a1969b6e10';
const hash = (s: string) => createHash('md5').update(s).digest('hex');
const provider = createFreeKassaProvider(config);
export function notification(amount = '1691.00') {
  return {
    MERCHANT_ID: config.merchantId, AMOUNT: amount, MERCHANT_ORDER_ID: orderId,
    SIGN: hash(`123:${amount}:fixture-word-two:${orderId}`), intid: '123456',
  };
}
test('FreeKassa hosted checkout signs fixed RUB quotes for all terms and is retry-stable', async () => {
  for (const months of [1, 3, 12]) {
    const quote = resolveBillingPlan('p300-1200', months)!;
    const input = {
      orderId, amountMinor: quote.totalAmountMinor, currency: 'RUB', description: 'Fixture',
      returnUrl: 'https://example.test/wallet', idempotencyKey: orderId,
    };
    const first = await provider.createPayment(input);
    assert.deepEqual(await provider.createPayment(input), first);
    assert.equal(first.paymentId, orderId);
    const url = new URL(first.confirmationUrl);
    const amount = (quote.totalAmountMinor / 100).toFixed(2);
    assert.equal(url.origin, 'https://pay.fk.money');
    assert.equal(url.searchParams.get('s'), hash(`123:${amount}:fixture-word-one:RUB:${orderId}`));
    assert.equal(url.searchParams.get('oa'), amount);
    assert.equal(url.searchParams.get('o'), orderId);
    assert.equal(url.searchParams.get('currency'), 'RUB');
    assert.equal(url.searchParams.has('i'), false, 'Do not invent available card/SBP methods');
    assert.equal(url.searchParams.has('success_url'), false, 'Not a documented SCI parameter');
    assert.equal(url.searchParams.has('em'), false, 'Do not invent customer email');
    assert.ok(!first.confirmationUrl.includes(config.secretWord1));
    assert.ok(!first.confirmationUrl.includes(config.secretWord2));
  }
});
test('FreeKassa verifies Secret Word 2 and parses minor units without float arithmetic', () => {
  for (const [amount, minor] of [['1691', 169100], ['1691.0', 169100], ['1691.01', 169101]] as const) {
    assert.deepEqual(provider.verifyNotification(notification(amount)), {
      id: orderId, orderId, amountMinor: minor, currency: 'RUB', status: 'succeeded',
    });
  }
  assert.equal(provider.verifyNotification({ ...notification(), CUR_ID: '42', credits: 999999 }).amountMinor, 169100);
});
test('FreeKassa rejects forged merchant, signature, altered amount and altered order', () => {
  for (const patch of [
    { MERCHANT_ID: '124' }, { AMOUNT: '1.00' },
    { SIGN: '0'.repeat(32) }, { SIGN: hash(`123:1691.00:fixture-word-one:${orderId}`) },
    { MERCHANT_ORDER_ID: 'a61d4001-0065-4d0f-853a-11a1969b6e10' },
  ]) {
    assert.throws(() => provider.verifyNotification({ ...notification(), ...patch }),
      (error: unknown) => error instanceof FreeKassaNotificationError && error.status === 403);
  }
});
test('FreeKassa rejects duplicate/non-scalar fields, malformed values, zero and incomplete data', () => {
  for (const body of [
    null, {}, { ...notification(), AMOUNT: ['1691.00', '1'] },
    { ...notification(), SIGN: [] }, { ...notification(), MERCHANT_ORDER_ID: '../wallet' },
    { ...notification(), AMOUNT: '1e3' }, { ...notification(), AMOUNT: '-1' },
    { ...notification(), AMOUNT: '1.001' }, notification('0'),
    { ...notification(), intid: '' },
  ]) assert.throws(() => provider.verifyNotification(body), FreeKassaNotificationError);
});
test('FreeKassa refuses non-RUB or invalid checkout data', async () => {
  const input = {
    orderId, amountMinor: 169100, currency: 'RUB', description: 'Fixture',
    returnUrl: 'https://example.test/wallet', idempotencyKey: orderId,
  };
  for (const patch of [{ currency: 'USD' }, { amountMinor: 0 }, { amountMinor: 0.1 }, { orderId: 'bad' }]) {
    await assert.rejects(provider.createPayment({ ...input, ...patch }));
  }
});
test('FreeKassa registry isolates test/live credentials and never enables payments from keys alone', () => {
  const env = {
    NODE_ENV: 'development', MEDUHA_PAYMENT_PROVIDER: 'freekassa',
    FREEKASSA_TEST_MERCHANT_ID: '123', FREEKASSA_TEST_SECRET_WORD_1: 'fixture-one',
    FREEKASSA_TEST_SECRET_WORD_2: 'fixture-two',
  };
  assert.equal(configuredPaymentProvider(env)?.id, 'freekassa');
  assert.equal(configuredFreeKassaProvider({ ...env, NODE_ENV: 'production' }), null);
  assert.equal(configuredFreeKassaProvider({ ...env, FREEKASSA_TEST_SECRET_WORD_2: '' }), null);
  assert.equal(paymentsEnabled(env), false);
});
