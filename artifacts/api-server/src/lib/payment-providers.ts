export type ProviderPaymentStatus = 'pending' | 'succeeded' | 'canceled';

export type PaymentIntent = {
  orderId: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  idempotencyKey: string;
};

export type VerifiedProviderPayment = {
  id: string;
  status: ProviderPaymentStatus;
  amountMinor: number;
  currency: string;
  orderId: string | null;
};

export interface PaymentProvider {
  readonly id: string;
  createPayment(input: PaymentIntent): Promise<{ paymentId: string; confirmationUrl: string }>;
  getPayment(paymentId: string): Promise<VerifiedProviderPayment>;
}

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export type YooKassaConfig = { shopId: string; secretKey: string };
type FetchLike = typeof fetch;
type ProviderFactory = (env: NodeJS.ProcessEnv, fetcher: FetchLike) => PaymentProvider | null;
const providerFactories = new Map<string, ProviderFactory>();

function parseMinorAmount(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new PaymentProviderError('Provider returned an invalid amount');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new PaymentProviderError('Provider returned an invalid amount');
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new PaymentProviderError('Payment provider request failed');
  const body: unknown = await response.json().catch(() => null);
  if (!isObject(body)) throw new PaymentProviderError('Payment provider returned an invalid response');
  return body;
}

export function createYooKassaProvider(config: YooKassaConfig, fetcher: FetchLike = fetch): PaymentProvider {
  if (!config.shopId.trim() || !config.secretKey.trim()) throw new PaymentProviderError('YooKassa is not configured');
  const authorization = `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`;
  const baseUrl = 'https://api.yookassa.ru/v3';

  return {
    id: 'yookassa',
    async createPayment(input) {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new PaymentProviderError('Invalid payment amount');
      }
      const response = await fetcher(`${baseUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          'Idempotence-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          amount: {
            value: (input.amountMinor / 100).toFixed(2),
            currency: input.currency,
          },
          capture: true,
          confirmation: { type: 'redirect', return_url: input.returnUrl },
          description: input.description,
          metadata: { order_id: input.orderId },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await readJson(response);
      const confirmation = isObject(body.confirmation) ? body.confirmation : null;
      const paymentId = typeof body.id === 'string' ? body.id : '';
      const confirmationUrl = typeof confirmation?.confirmation_url === 'string'
        ? confirmation.confirmation_url : '';
      let parsedUrl: URL | null = null;
      try { parsedUrl = new URL(confirmationUrl); } catch { /* invalid URL */ }
      if (!paymentId || !parsedUrl || parsedUrl.protocol !== 'https:') {
        throw new PaymentProviderError('Payment provider returned an invalid checkout URL');
      }
      return { paymentId, confirmationUrl: parsedUrl.toString() };
    },
    async getPayment(paymentId) {
      if (!paymentId || paymentId.length > 200 || /[\s/]/.test(paymentId)) {
        throw new PaymentProviderError('Invalid provider payment ID');
      }
      const response = await fetcher(`${baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await readJson(response);
      const amount = isObject(body.amount) ? body.amount : null;
      const metadata = isObject(body.metadata) ? body.metadata : null;
      const status = body.status === 'succeeded' ? 'succeeded'
        : body.status === 'canceled' ? 'canceled' : 'pending';
      if (typeof body.id !== 'string' || !amount || typeof amount.currency !== 'string') {
        throw new PaymentProviderError('Payment provider returned an incomplete payment');
      }
      return {
        id: body.id,
        status,
        amountMinor: parseMinorAmount(amount.value),
        currency: amount.currency,
        orderId: typeof metadata?.order_id === 'string' ? metadata.order_id : null,
      };
    },
  };
}

export function configuredPaymentProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: FetchLike = fetch,
): PaymentProvider | null {
  const providerId = env.MEDUHA_PAYMENT_PROVIDER || 'yookassa';
  return providerFactories.get(providerId)?.(env, fetcher) ?? null;
}

export function paymentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MEDUHA_PAYMENTS_ENABLED !== 'true') return false;
  return env.NODE_ENV !== 'production' || env.MEDUHA_PAYMENT_TERMS_FINALIZED === 'true';
}

/** Register one isolated adapter per provider; checkout records retain that ID. */
export function registerPaymentProvider(id: string, factory: ProviderFactory): void {
  if (!/^[a-z0-9_-]{2,40}$/.test(id)) throw new Error('Invalid payment provider ID');
  providerFactories.set(id, factory);
}

registerPaymentProvider('yookassa', (env, fetcher) => {
  const prefix = env.NODE_ENV === 'production' ? 'YOOKASSA_LIVE' : 'YOOKASSA_TEST';
  const shopId = env[`${prefix}_SHOP_ID`];
  const secretKey = env[`${prefix}_SECRET_KEY`];
  if (!shopId || !secretKey) return null;
  return createYooKassaProvider({ shopId, secretKey }, fetcher);
});
