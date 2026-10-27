import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredPaymentProvider,
  createYooKassaProvider,
  paymentsEnabled,
  PaymentProviderError,
} from './payment-providers';
import { resolveBillingPlan } from './billing-pricing';

test('YooKassa adapter sends a fixed amount with idempotency and returns only its HTTPS checkout URL', async () => {
  let captured: RequestInit | undefined;
  const provider = createYooKassaProvider({ shopId: 'test-shop', secretKey: 'test-secret' }, async (_input, init) => {
    captured = init;
    return Response.json({
      id: 'provider-payment-1',
      confirmation: { confirmation_url: 'https://yookassa.ru/checkout/payment/test' },
    }, { status: 201 });
  });
  const result = await provider.createPayment({
    orderId: 'order-1', amountMinor: 169100, currency: 'RUB',
    description: 'Meduha test', returnUrl: 'https://example.test/wallet',
    idempotencyKey: 'order-idempotency-1',
  });
  assert.equal(result.paymentId, 'provider-payment-1');
  assert.equal(result.confirmationUrl, 'https://yookassa.ru/checkout/payment/test');
  assert.equal((captured?.headers as Record<string, string>)['Idempotence-Key'], 'order-idempotency-1');
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    amount: { value: '1691.00', currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: 'https://example.test/wallet' },
    description: 'Meduha test',
    metadata: { order_id: 'order-1' },
  });
});

test('YooKassa checkout uses the catalog RUB total for 1, 3 and 12 month terms', async () => {
  const amounts: { value: string; currency: string }[] = [];
  const provider = createYooKassaProvider(
    { shopId: 'test-shop', secretKey: 'test-secret' },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      amounts.push(body.amount);
      return Response.json({
        id: `provider-payment-${amounts.length}`,
        confirmation: { confirmation_url: 'https://yookassa.ru/checkout/payment/test' },
      }, { status: 201 });
    },
  );
  for (const months of [1, 3, 12]) {
    const quote = resolveBillingPlan('p300-1200', months)!;
    await provider.createPayment({
      orderId: `order-${months}`,
      amountMinor: quote.totalAmountMinor,
      currency: 'RUB',
      description: 'Meduha test',
      returnUrl: 'https://example.test/wallet',
      idempotencyKey: `order-${months}`,
    });
  }
  assert.deepEqual(
    amounts,
    [1, 3, 12].map(months => ({
      value: (resolveBillingPlan('p300-1200', months)!.totalAmountMinor / 100).toFixed(2),
      currency: 'RUB',
    })),
  );
});

test('YooKassa verification parses authoritative status and minor units', async () => {
  const provider = createYooKassaProvider({ shopId: 'test-shop', secretKey: 'test-secret' }, async () =>
    Response.json({
      id: 'payment-2', status: 'succeeded',
      amount: { value: '5251.35', currency: 'RUB' },
      metadata: { order_id: 'local-order-2' },
    }),
  );
  assert.deepEqual(await provider.getPayment('payment-2'), {
    id: 'payment-2', status: 'succeeded', amountMinor: 525135,
    currency: 'RUB', orderId: 'local-order-2',
  });
});

test('payment adapter rejects provider errors and incomplete credentials without exposing secrets', async () => {
  const provider = createYooKassaProvider({ shopId: 'test-shop', secretKey: 'test-secret' }, async () =>
    Response.json({ description: 'sensitive provider detail' }, { status: 401 }),
  );
  await assert.rejects(provider.getPayment('payment-3'), (error: unknown) =>
    error instanceof PaymentProviderError && !error.message.includes('sensitive'));
  assert.equal(configuredPaymentProvider({ NODE_ENV: 'development', YOOKASSA_TEST_SHOP_ID: 'shop' }), null);
  assert.equal(paymentsEnabled({ NODE_ENV: 'production', MEDUHA_PAYMENTS_ENABLED: 'true' }), false);
  assert.equal(paymentsEnabled({
    NODE_ENV: 'production', MEDUHA_PAYMENTS_ENABLED: 'true', MEDUHA_PAYMENT_TERMS_FINALIZED: 'true',
  }), true);
  assert.equal(paymentsEnabled({ NODE_ENV: 'development', MEDUHA_PAYMENTS_ENABLED: 'true' }), true);
});
