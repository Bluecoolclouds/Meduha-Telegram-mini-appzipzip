import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import {
  CreateMeduhaPaymentOrderBody,
  ReceiveMeduhaYooKassaNotificationBody,
} from '@workspace/api-zod';
import {
  createPendingPaymentOrder,
  findPaymentOrderByProviderPaymentId,
  getPaymentOrderForAccount,
  grantNextDueInstallment,
  markVerifiedPayment,
  savePaymentCheckout,
} from '../lib/billing-orders';
import { getBillingPlans, INITIAL_PAYMENT_PROVIDER, resolveBillingPlan, BILLING_CURRENCY, USD_TO_RUB_REFERENCE_RATE } from '../lib/billing-pricing';
import { configuredPaymentProvider, paymentsEnabled } from '../lib/payment-providers';
import { requireAccount } from './meduha-auth';

function configuredBaseUrl(req: Request): URL | null {
  const configured = process.env.MEDUHA_PUBLIC_URL;
  const developmentOrigin = process.env.NODE_ENV === 'production' ? undefined : req.get('origin');
  const raw = configured || developmentOrigin;
  if (!raw) return null;

  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;

  const allowedHosts = [
    ...(process.env.REPLIT_DOMAINS ?? '').split(','),
    process.env.REPLIT_DEV_DOMAIN ?? '',
  ].map(value => value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  if (allowedHosts.length && !allowedHosts.includes(url.host)) return null;
  return url;
}

function redirectAfterPayment(baseUrl: URL, orderId: string): string {
  const url = new URL('/wallet', baseUrl);
  url.searchParams.set('payment_order', orderId);
  return url.toString();
}

export function createMeduhaPaymentsRouter() {
  const router = Router();

  router.get('/billing/catalog', (_req, res) => {
    const provider = configuredPaymentProvider();
    res.json({
      currency: BILLING_CURRENCY,
      referenceRate: USD_TO_RUB_REFERENCE_RATE,
      checkoutAvailable: paymentsEnabled() && !!provider
        && (process.env.NODE_ENV !== 'production' || !!process.env.MEDUHA_PUBLIC_URL),
      plans: getBillingPlans(),
    });
  });

  router.post('/payments/orders', async (req, res) => {
    if (req.get('X-Meduha-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ code: 'REQUEST_ORIGIN_REQUIRED', error: 'Запрос должен исходить из приложения meduha.' });
      return;
    }
    const parsed = CreateMeduhaPaymentOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Проверь выбранный тариф и срок.' });
      return;
    }
    const account = await requireAccount(req, res);
    if (!account) return;

    if (!paymentsEnabled()) {
      res.status(503).json({ code: 'PAYMENTS_DISABLED', error: 'Оплата ещё не включена.' });
      return;
    }
    const providerId = process.env.MEDUHA_PAYMENT_PROVIDER || INITIAL_PAYMENT_PROVIDER;
    const provider = configuredPaymentProvider();
    const baseUrl = configuredBaseUrl(req);
    if (!provider || provider.id !== providerId || !baseUrl) {
      res.status(503).json({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', error: 'Оплата пока не настроена.' });
      return;
    }

    const quote = resolveBillingPlan(parsed.data.planId, parsed.data.termMonths);
    if (!quote) {
      res.status(400).json({ code: 'INVALID_INPUT', error: 'Такого тарифа или срока нет.' });
      return;
    }
    try {
      const order = await createPendingPaymentOrder({
        accountId: account.id,
        idempotencyKey: parsed.data.idempotencyKey,
        planId: parsed.data.planId,
        termMonths: parsed.data.termMonths,
        providerId,
      });
      if (order.status === 'canceled' || order.status === 'failed') {
        res.status(409).json({ code: 'PAYMENT_ORDER_CLOSED', error: 'Создай новый платёж для выбранного тарифа.' });
        return;
      }
      if (order.payment_url) {
        res.status(201).json({
          orderId: order.id, providerId, paymentUrl: order.payment_url,
          amountMinor: order.amount_minor, currency: order.currency, status: order.status,
        });
        return;
      }

      const checkout = await provider.createPayment({
        orderId: order.id,
        amountMinor: order.amount_minor,
        currency: order.currency,
        description: `Meduha · ${order.monthly_credits} кредитов в месяц · ${order.term_months} мес.`,
        returnUrl: redirectAfterPayment(baseUrl, order.id),
        idempotencyKey: order.id,
      });
      await savePaymentCheckout({
        orderId: order.id, providerId, providerPaymentId: checkout.paymentId,
        paymentUrl: checkout.confirmationUrl,
      });
      res.status(201).json({
        orderId: order.id, providerId, paymentUrl: checkout.confirmationUrl,
        amountMinor: order.amount_minor, currency: order.currency, status: order.status,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      req.log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError', code },
        'Payment order creation failed');
      if (code === 'INVALID_BILLING_SELECTION') {
        res.status(400).json({ code: 'INVALID_INPUT', error: 'Такого тарифа или срока нет.' });
      } else if (code === 'IDEMPOTENCY_CONFLICT') {
        res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', error: 'Этот запрос оплаты уже использован.' });
      } else {
        res.status(503).json({ code: 'PAYMENT_CREATE_FAILED', error: 'Не удалось создать ссылку на оплату. Попробуй ещё раз.' });
      }
    }
  });

  router.get('/payments/orders/:orderId', async (req, res) => {
    const account = await requireAccount(req, res);
    if (!account) return;
    const result = await getPaymentOrderForAccount(req.params.orderId, account.id);
    if (!result) {
      res.status(404).json({ code: 'PAYMENT_ORDER_NOT_FOUND', error: 'Платёж не найден.' });
      return;
    }
    const { order, grantedMonths } = result;
    res.json({
      orderId: order.id,
      providerId: order.provider_id,
      status: order.status,
      amountMinor: order.amount_minor,
      currency: order.currency,
      termMonths: order.term_months,
      monthlyCredits: order.monthly_credits,
      grantedMonths,
    });
  });

  return router;
}

/** Provider callback: the notification itself never grants credits; the
 * adapter fetches current payment state from YooKassa before local settlement. */
export function createYooKassaWebhookRouter() {
  const router = Router();
  router.post('/yookassa/webhook', async (req, res) => {
    const parsed = ReceiveMeduhaYooKassaNotificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_NOTIFICATION' });
      return;
    }
    if (!['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture'].includes(parsed.data.event)) {
      res.sendStatus(200);
      return;
    }
    const provider = configuredPaymentProvider();
    if (!provider || provider.id !== 'yookassa') {
      res.status(503).json({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
      return;
    }

    try {
      // Ignore unrecognized IDs before calling the provider API; external
      // notifications must not turn into an unauthenticated API proxy.
      const knownOrderId = await findPaymentOrderByProviderPaymentId(provider.id, parsed.data.object.id);
      if (!knownOrderId) {
        res.sendStatus(200);
        return;
      }
      const verified = await provider.getPayment(parsed.data.object.id);
      if (!verified.orderId) {
        req.log.warn({ providerPaymentId: verified.id }, 'Ignoring provider notification without a local order');
        res.sendStatus(200);
        return;
      }
      const order = await markVerifiedPayment(provider.id, verified);
      if (!order) {
        req.log.warn({ orderId: verified.orderId }, 'Ignoring provider notification for an unknown order');
        res.sendStatus(200);
        return;
      }
      if (order.status === 'succeeded') {
        for (let count = 0; count < 12; count++) {
          if (!await grantNextDueInstallment()) break;
        }
      }
      res.sendStatus(200);
    } catch (error) {
      req.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Could not verify provider payment notification');
      res.status(503).json({ code: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
    }
  });
  return router;
}
