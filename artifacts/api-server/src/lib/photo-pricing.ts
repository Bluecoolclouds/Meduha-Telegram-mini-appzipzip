import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import catalog from './photo-catalog.json';
import { higgsfieldCredentials } from './higgsfield';
import { photoBatchSize, photoModels, stablePhotoInput, type PhotoMetadata } from './photo';

export class PhotoPricingError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const reject = () => new PhotoPricingError('UNSAFE_PHOTO_PRICE', 'Нет достоверной сметы для этих настроек. Запуск заблокирован.');
const stale = () => new PhotoPricingError('STALE_PRICE_QUOTE', 'Смета истекла или настройки изменились. Рассчитай и подтверди цену заново.');
const secret = () => {
  if (!process.env.SESSION_SECRET) throw new PhotoPricingError('QUOTE_UNAVAILABLE', 'Расчёт цены не настроен.', 503);
  return process.env.SESSION_SECRET;
};
export function photoPricingBlockedReason(endpoint: string): string | null {
  const blocked = catalog.pricing.blockedEndpoints as Record<string, string>;
  const rates = catalog.pricing.referenceMaxUsdMicros as Record<string, number>;
  return blocked[endpoint] ?? (!rates[endpoint] ? 'Нет проверенного тарифа — запуск заблокирован.' : null);
}
export function photoPricingFingerprint(basePrice: number) {
  return createHash('sha256').update(stablePhotoInput({ basePrice, policy: catalog.pricing })).digest('hex');
}
export const photoRequestHash = (metadata: PhotoMetadata) => createHash('sha256').update(stablePhotoInput(metadata)).digest('hex');

export type PhotoQuoteClaims = {
  purpose: 'photo-price';
  accountId: string; modelId: string; idempotencyKey: string;
  requestHash: string; pricingFingerprint: string;
  creditPrice: number; expiresAt: number; usdMicros: number;
};

// Decimal arithmetic avoids under-reserving at a floating-point rounding boundary.
export function photoEstimateMicros(usd: unknown): number {
  if (typeof usd !== 'string' || !/^\d{1,6}(?:\.\d{1,6})?$/.test(usd)) throw reject();
  const [whole, fraction = ''] = usd.split('.');
  const micros = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(micros) || micros <= 0) throw reject();
  return micros;
}
export function photoQuotedPrice(basePrice: number, metadata: PhotoMetadata, usdMicros: number) {
  if (photoPricingBlockedReason(metadata.endpoint)) throw reject();
  const maximum = (catalog.pricing.referenceMaxUsdMicros as Record<string, number>)[metadata.endpoint];
  const batch = photoBatchSize(metadata.parameters);
  if (!Number.isSafeInteger(basePrice) || basePrice <= 0) {
    throw new PhotoPricingError('MODEL_NOT_PRICED', 'Для модели ещё не задана цена.');
  }
  // Never treat a provider estimate above the verified published range as safe.
  if (!Number.isSafeInteger(usdMicros) || usdMicros <= 0 || usdMicros > maximum * batch) throw reject();
  const numerator = BigInt(basePrice) * BigInt(usdMicros);
  const total = Number((numerator + BigInt(maximum) - 1n) / BigInt(maximum));
  if (!Number.isSafeInteger(total) || total <= 0 || total > 100_000_000) throw reject();
  return total;
}
export function signPhotoQuote(claims: PhotoQuoteClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function verifyPhotoQuote(token: string, allowExpired = false): PhotoQuoteClaims {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || token.length > 8192) throw stale();
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw stale();
  let claims: PhotoQuoteClaims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw stale(); }
  if (claims?.purpose !== 'photo-price' || !Number.isSafeInteger(claims.expiresAt)
    || (!allowExpired && claims.expiresAt <= Date.now())
    || !Number.isSafeInteger(claims.creditPrice) || claims.creditPrice <= 0) throw stale();
  return claims;
}
export function assertPhotoQuote(claims: PhotoQuoteClaims, accountId: string, modelId: string, key: string, metadata: PhotoMetadata, price: number) {
  if (claims.accountId !== accountId || claims.modelId !== modelId || claims.idempotencyKey !== key
    || claims.requestHash !== photoRequestHash(metadata) || claims.creditPrice !== price) throw stale();
}
export function photoQuoteSummary(metadata: PhotoMetadata) {
  const properties = photoModels.find(m => m.id === metadata.catalogId)!.schema.properties as Record<string, { default?: unknown } | undefined>;
  return {
    images: photoBatchSize(metadata.parameters),
    referenceCount: Object.values(metadata.references).reduce((n, ids) => n + ids.length, 0),
    resolution: String(metadata.parameters.resolution ?? properties.resolution?.default ?? 'стандартное'),
    quality: String(metadata.parameters.quality ?? properties.quality?.default ?? 'стандартное'),
  };
}
// This is only the documented non-generating estimate endpoint. No retries,
// generation calls or fallback to the illustrative public price.
export async function estimatePhotoRequest(endpoint: string, input: Record<string, unknown>): Promise<number> {
  if (photoPricingBlockedReason(endpoint)) throw reject();
  try {
    const response = await fetch(`https://api.higgsfield.ai/estimate/${endpoint}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Key ${higgsfieldCredentials()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Estimate rejected');
    const body = await response.json() as { usd?: unknown };
    return photoEstimateMicros(body.usd);
  } catch (error) {
    if (error instanceof PhotoPricingError) throw error;
    throw new PhotoPricingError('QUOTE_UNAVAILABLE', 'Не удалось получить смету провайдера. Кредиты не зарезервированы, генерация не запущена.', 503);
  }
}
