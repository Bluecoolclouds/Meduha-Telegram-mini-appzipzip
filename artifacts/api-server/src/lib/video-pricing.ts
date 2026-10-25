import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { higgsfieldCredentials } from './higgsfield';
import { stablePhotoInput } from './photo';
import { photoEstimateMicros } from './photo-pricing';
import type { VideoMetadata } from './video';

export class VideoPricingError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export const seedancePricingEndpoints = new Set([
  'text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'video-extend',
].map(mode => `bytedance/seedance-2.5/${mode}`));

// Numeric model configuration lives with the existing administrator's model
// parameters. These keys are opt-in; absent keys preserve legacy fixed prices.
export function videoPricingPolicy(endpoint: string, limits: Record<string, number> | null | undefined) {
  const hasPolicy = limits?.videoCreditsPerUsd !== undefined || limits?.videoMaxUsd !== undefined;
  if (!hasPolicy) return null;
  const rate = limits?.videoCreditsPerUsd, maximum = limits?.videoMaxUsd;
  if (!seedancePricingEndpoints.has(endpoint) || !Number.isSafeInteger(rate) || rate! < 1 || rate! > 1_000_000
    || typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0 || maximum > 10_000
    || Number(maximum.toFixed(6)) !== maximum) {
    throw new VideoPricingError('MODEL_NOT_PRICED', 'Проверь курс кредитов и максимальную стоимость сметы Seedance 2.5.');
  }
  const maxUsdMicros = photoEstimateMicros(maximum.toFixed(6));
  if (BigInt(rate!) * BigInt(maxUsdMicros) > 100_000_000n * 1_000_000n) {
    throw new VideoPricingError('MODEL_NOT_PRICED', 'Максимальная цена превышает допустимое число кредитов.');
  }
  return { creditsPerUsd: rate!, maxUsdMicros };
}
export const videoPricingFingerprint = (policy: NonNullable<ReturnType<typeof videoPricingPolicy>>) =>
  createHash('sha256').update(stablePhotoInput({ version: 1, ...policy })).digest('hex');
export const videoRequestHash = (metadata: VideoMetadata) =>
  createHash('sha256').update(stablePhotoInput(metadata)).digest('hex');
export function videoQuotedPrice(policy: NonNullable<ReturnType<typeof videoPricingPolicy>>, usdMicros: number) {
  if (!Number.isSafeInteger(usdMicros) || usdMicros <= 0 || usdMicros > policy.maxUsdMicros) {
    throw new VideoPricingError('UNSAFE_VIDEO_PRICE', 'Смета превышает установленный максимум или не подтверждена. Запуск заблокирован.');
  }
  return Number((BigInt(usdMicros) * BigInt(policy.creditsPerUsd) + 999_999n) / 1_000_000n);
}
type Claims = {
  purpose: 'video-price'; accountId: string; modelId: string; idempotencyKey: string;
  requestHash: string; pricingFingerprint: string; usdMicros: number; creditPrice: number; expiresAt: number;
};
const secret = () => {
  if (!process.env.SESSION_SECRET) throw new VideoPricingError('QUOTE_UNAVAILABLE', 'Расчёт цены не настроен.', 503);
  return process.env.SESSION_SECRET;
};
const stale = () => new VideoPricingError('STALE_PRICE_QUOTE', 'Цена истекла или настройки изменились. Рассчитай и подтверди её заново.');
export function signVideoQuote(claims: Claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function verifyVideoQuote(token: string | undefined): Claims {
  if (!token || token.length > 8192) throw stale();
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw stale();
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw stale();
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw stale(); }
  if (!claims || claims.purpose !== 'video-price' || !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt <= Date.now()) throw stale();
  return claims;
}
export function assertVideoQuote(claims: Claims, accountId: string, modelId: string, key: string,
  metadata: VideoMetadata, policy: NonNullable<ReturnType<typeof videoPricingPolicy>>, price: number) {
  if (claims.accountId !== accountId || claims.modelId !== modelId || claims.idempotencyKey !== key
    || claims.requestHash !== videoRequestHash(metadata) || claims.pricingFingerprint !== videoPricingFingerprint(policy)
    || claims.creditPrice !== price || videoQuotedPrice(policy, claims.usdMicros) !== price) throw stale();
}
export async function estimateVideoRequest(endpoint: string, input: Record<string, unknown>) {
  if (!seedancePricingEndpoints.has(endpoint)) throw new VideoPricingError('MODEL_NOT_PRICED', 'Для этого режима нет расчёта сметы.');
  // Documented estimate endpoint only. Never call a generation endpoint as fallback.
  try {
    const response = await fetch(`https://api.higgsfield.ai/estimate/${endpoint}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Key ${higgsfieldCredentials()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Estimate rejected');
    return photoEstimateMicros((await response.json() as { usd?: unknown }).usd);
  } catch {
    throw new VideoPricingError('QUOTE_UNAVAILABLE', 'Не удалось получить смету. Генерация не запущена, кредиты не зарезервированы.', 503);
  }
}
