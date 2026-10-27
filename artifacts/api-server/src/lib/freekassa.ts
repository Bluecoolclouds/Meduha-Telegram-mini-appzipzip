import { createHash, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider, VerifiedProviderPayment } from './payment-providers';

export type FreeKassaConfig = { merchantId: string; secretWord1: string; secretWord2: string };
export class FreeKassaNotificationError extends Error {
  constructor(readonly status: 400 | 403) {
    super(status === 403 ? 'INVALID_FREEKASSA_SIGNATURE' : 'INVALID_FREEKASSA_NOTIFICATION');
    this.name = 'FreeKassaNotificationError';
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex');

export interface FreeKassaProvider extends PaymentProvider {
  verifyNotification(body: unknown): VerifiedProviderPayment;
}

/** Hosted SCI: no fabricated payer email, method IDs, API key or API nonce.
 * Source: https://docs.freekassa.net/ SCI sections 1.3–1.7.
 * SCI's payment reference is our immutable UUID, not the unsigned intid field. */
export function createFreeKassaProvider(config: FreeKassaConfig): FreeKassaProvider {
  if (!/^[1-9]\d{0,15}$/.test(config.merchantId) || !config.secretWord1.trim() || !config.secretWord2.trim()) {
    throw new Error('FREEKASSA_NOT_CONFIGURED');
  }
  return {
    id: 'freekassa',
    async createPayment(input) {
      if (!uuid.test(input.orderId) || input.currency !== 'RUB'
        || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) {
        throw new Error('INVALID_FREEKASSA_PAYMENT');
      }
      const amount = (input.amountMinor / 100).toFixed(2);
      const signature = md5(`${config.merchantId}:${amount}:${config.secretWord1}:RUB:${input.orderId}`);
      const params = new URLSearchParams({
        m: config.merchantId, oa: amount, currency: 'RUB', o: input.orderId,
        s: signature, lang: 'ru',
      });
      // SCI return/notification URLs are configured in the merchant dashboard.
      // They are not the API-only success_url overrides.
      return { paymentId: input.orderId, confirmationUrl: `https://pay.fk.money/?${params}` };
    },
    verifyNotification(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FreeKassaNotificationError(400);
      const values = body as Record<string, unknown>;
      const { MERCHANT_ID: merchant, AMOUNT: amount, MERCHANT_ORDER_ID: orderId, SIGN: sign, intid } = values;
      if (typeof merchant !== 'string' || typeof amount !== 'string' || typeof orderId !== 'string'
        || typeof sign !== 'string' || typeof intid !== 'string'
        || !uuid.test(orderId) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)
        || !/^[a-f0-9]{32}$/i.test(sign) || !/^[1-9]\d{0,30}$/.test(intid)) {
        throw new FreeKassaNotificationError(400);
      }
      const expected = md5(`${config.merchantId}:${amount}:${config.secretWord2}:${orderId}`);
      if (merchant !== config.merchantId
        || !timingSafeEqual(Buffer.from(sign.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'))) {
        throw new FreeKassaNotificationError(403);
      }
      const [whole, fraction = ''] = amount.split('.');
      const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new FreeKassaNotificationError(400);
      // This adapter only creates RUB orders. CUR_ID is the payer's payment
      // method, NOT the order currency; never trust it to set local currency.
      return { id: orderId, orderId, amountMinor, currency: 'RUB', status: 'succeeded' };
    },
  };
}

export function configuredFreeKassaProvider(env: NodeJS.ProcessEnv = process.env): FreeKassaProvider | null {
  const prefix = env.NODE_ENV === 'production' ? 'FREEKASSA_LIVE' : 'FREEKASSA_TEST';
  const merchantId = env[`${prefix}_MERCHANT_ID`];
  const secretWord1 = env[`${prefix}_SECRET_WORD_1`];
  const secretWord2 = env[`${prefix}_SECRET_WORD_2`];
  if (!merchantId || !secretWord1 || !secretWord2 || !/^[1-9]\d{0,15}$/.test(merchantId)
    || !secretWord1.trim() || !secretWord2.trim()) return null;
  return createFreeKassaProvider({ merchantId, secretWord1, secretWord2 });
}
