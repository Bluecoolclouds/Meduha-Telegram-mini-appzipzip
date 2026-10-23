import { createHmac, timingSafeEqual } from 'node:crypto';

export class TelegramAuthError extends Error {
  constructor(public code: 'INVALID_TELEGRAM_DATA' | 'EXPIRED_TELEGRAM_DATA') {
    super(code);
  }
}

export type VerifiedTelegramUser = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  languageCode: string;
};

/** Bot-token validation from core.telegram.org/bots/webapps.
 * Only hash is excluded for HMAC (the separate Ed25519 flow excludes signature too).
 * This function does not read environment variables, call Telegram or log credentials.
 */
export function validateTelegramInitData(
  raw: string, botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 600,
): VerifiedTelegramUser {
  const invalid = () => new TelegramAuthError('INVALID_TELEGRAM_DATA');
  if (!raw || raw.length > 16384 || !botToken) throw invalid();
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) throw invalid();
    seen.add(key);
  }
  const hash = params.get('hash');
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) throw invalid();
  const pairs = [...params.entries()].filter(([key]) => key !== 'hash').sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const dataCheckString = pairs.map(([key,value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw invalid();
  const authDate = params.get('auth_date') ?? '';
  if (!/^\d+$/.test(authDate)) throw invalid();
  const age = nowSeconds - Number(authDate);
  if (!Number.isSafeInteger(Number(authDate)) || age < -30) throw invalid();
  if (age > maxAgeSeconds) throw new TelegramAuthError('EXPIRED_TELEGRAM_DATA');
  let value: unknown;
  try { value = JSON.parse(params.get('user') ?? 'null'); } catch { throw invalid(); }
  if (!value || typeof value !== 'object') throw invalid();
  const user = value as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0 ||
      typeof user.first_name !== 'string' || !user.first_name.trim() || user.first_name.length > 256 ||
      user.is_bot === true) throw invalid();
  const optional = (key:string, max=256):string|null => {
    const field=user[key];
    if(field === undefined || field === null)return null;
    if(typeof field !== 'string' || field.length > max)throw invalid();
    return field;
  };
  const photoUrl=optional('photo_url',2048);
  if(photoUrl && !photoUrl.startsWith('https://'))throw invalid();
  return {
    id:String(user.id),firstName:user.first_name,lastName:optional('last_name'),
    username:optional('username'),photoUrl,languageCode:optional('language_code',30)||'ru',
  };
}
