import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import type { PaymentOrderRow } from '../lib/billing-orders';
import { createFreeKassaProvider } from '../lib/freekassa';
import { createFreeKassaPaymentsRouter } from './freekassa-payments';

test('FreeKassa HTTP notification rejects forged input before DB, retries errors, and never grants from return', async t => {
  const orderId = 'c61d4001-0065-4d0f-853a-11a1969b6e10';
  const provider = createFreeKassaProvider({ merchantId: '123', secretWord1: 'fixture-one', secretWord2: 'fixture-two' });
  const body = {
    MERCHANT_ID: '123', AMOUNT: '1691.00', MERCHANT_ORDER_ID: orderId, intid: '123456',
    SIGN: createHash('md5').update(`123:1691.00:fixture-two:${orderId}`).digest('hex'),
  };
  let configured = true; let known = true; let failure = ''; let lookups = 0; let settlements = 0;
  let granted = false; let grants = 0;
  const app = express();
  app.use(express.urlencoded({ extended: false }), cookieParser());
  app.use('/api/meduha/payments', createFreeKassaPaymentsRouter({
    provider: () => configured ? provider : null,
    findOrder: async () => { lookups++; return known ? orderId : null; },
    settle: async (id, payment) => {
      settlements++;
      assert.equal(id, 'freekassa');
      assert.equal(payment.amountMinor, 169100);
      if (failure) throw new Error(failure);
      return { status: 'succeeded' } as PaymentOrderRow;
    },
    grant: async () => {
      if (granted) return false;
      granted = true; grants++; return true;
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/meduha/payments/freekassa`;
  const post = (fields = body) => fetch(`${base}/notify`, { method: 'POST', body: new URLSearchParams(fields) });
  assert.equal((await post({ ...body, SIGN: '0'.repeat(32) })).status, 403);
  assert.equal(lookups, 0);
  assert.equal(settlements, 0);
  assert.equal((await post({ ...body, AMOUNT: 'bad' })).status, 400);
  configured = false;
  assert.equal((await post()).status, 503);
  configured = true; known = false;
  assert.equal((await post()).status, 404);
  assert.equal(settlements, 0);
  known = true; failure = 'PAYMENT_DETAILS_MISMATCH';
  assert.equal((await post()).status, 409);
  assert.equal(grants, 0);
  failure = 'database temporarily unavailable';
  assert.equal((await post()).status, 503);
  assert.equal(grants, 0);
  failure = '';
  const results = await Promise.all([post(), post(), post()]);
  for (const response of results) {
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'YES');
  }
  assert.equal(grants, 1, 'Retries use shared idempotent settlement/ledger');
  const before = settlements;
  const redirect = await fetch(`${base}/return?status=success&payment_order=forged`, { redirect: 'manual' });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/wallet');
  const correlated = await fetch(`${base}/return`, {
    redirect: 'manual', headers: { Cookie: `meduha_freekassa_return=${orderId}` },
  });
  assert.equal(correlated.headers.get('location'), `/wallet?payment_order=${orderId}`);
  assert.equal(settlements, before, 'Success return never settles any payment');
});
