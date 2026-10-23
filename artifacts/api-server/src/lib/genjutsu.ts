import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db, meduhaUploads } from '@workspace/db';
import { templateFile, templateProviderUrl } from './objectStorage';
import { higgsfieldCredentials } from './higgsfield';

export const GENJUTSU_ENDPOINTS = {
  genjutsu: 'higgsfield/genjutsu/motion-transfer/v1.0',
  'object-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  restyle: 'higgsfield/genjutsu/restyle/v1.0',
} as const;
export type GenjutsuScenario = keyof typeof GENJUTSU_ENDPOINTS;
export type GenjutsuResolution = '480p' | '720p' | '1080p';
export type GenjutsuTariff = {
  scenario: GenjutsuScenario;
  resolution: GenjutsuResolution;
  duration: number;
  creditPrice: number;
};
export type GenjutsuQuoteClaims = {
  version: 1;
  accountId: string;
  modelId: string;
  scenario: GenjutsuScenario;
  videoId: string;
  resolution: GenjutsuResolution;
  duration: number;
  creditPrice: number;
  pricingFingerprint: string;
  expiresAt: number;
};
export type GenjutsuMetadata = {
  scenario: GenjutsuScenario;
  endpoint: string;
  videoId: string;
  imageIds: string[];
  presetId?: string;
};
export class GenjutsuError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const exec = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tariffKey = (tariff: Pick<GenjutsuTariff, 'scenario' | 'resolution' | 'duration'>) =>
  `${tariff.scenario}:${tariff.resolution}:${tariff.duration}`;

function canonicalTariffs(pricing: unknown): GenjutsuTariff[] {
  if (!Array.isArray(pricing)) throw new GenjutsuError('Тариф модели настроен некорректно.', 503);
  const seen = new Set<string>();
  const tariffs = pricing.map((item): GenjutsuTariff => {
    if (!item || typeof item !== 'object') throw new GenjutsuError('Тариф модели настроен некорректно.', 503);
    const value = item as Record<string, unknown>;
    const tariff = {
      scenario: value.scenario as GenjutsuScenario,
      resolution: value.resolution as GenjutsuResolution,
      duration: value.duration as number,
      creditPrice: value.creditPrice as number,
    };
    if (!Object.hasOwn(GENJUTSU_ENDPOINTS, tariff.scenario)
      || !['480p', '720p', '1080p'].includes(tariff.resolution)
      || !Number.isSafeInteger(tariff.duration) || tariff.duration < 4 || tariff.duration > 30
      || !Number.isSafeInteger(tariff.creditPrice) || tariff.creditPrice < 1) {
      throw new GenjutsuError('Тариф модели настроен некорректно.', 503);
    }
    const key = tariffKey(tariff);
    if (seen.has(key)) throw new GenjutsuError('В тарифе модели есть повторяющиеся параметры.', 503);
    seen.add(key);
    return tariff;
  });
  return tariffs.sort((a, b) => tariffKey(a).localeCompare(tariffKey(b)));
}

export function genjutsuPricingFingerprint(creditPrice: number, pricing: unknown): string {
  const tariffs = canonicalTariffs(pricing);
  return createHash('sha256').update(JSON.stringify({ creditPrice, tariffs })).digest('hex');
}

export function configuredGenjutsuPrice(
  creditPrice: number,
  pricing: unknown,
  selection: Pick<GenjutsuTariff, 'scenario' | 'resolution' | 'duration'>,
): number | null {
  const tariffs = canonicalTariffs(pricing);
  if (tariffs.length === 0) {
    return Number.isSafeInteger(creditPrice) && creditPrice > 0 ? creditPrice : null;
  }
  const match = tariffs.find(tariff => tariffKey(tariff) === tariffKey(selection));
  return match?.creditPrice ?? null;
}

function quoteSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new GenjutsuError('Сервис расчёта цены не настроен.', 503);
  return secret;
}

export function signGenjutsuQuote(claims: GenjutsuQuoteClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', quoteSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGenjutsuQuote(token: string): GenjutsuQuoteClaims {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw new GenjutsuError('Котировка повреждена. Запроси цену заново.', 409);
  const expected = createHmac('sha256', quoteSecret()).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); }
  catch { throw new GenjutsuError('Котировка повреждена. Запроси цену заново.', 409); }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new GenjutsuError('Котировка изменена. Запроси цену заново.', 409);
  }
  let claims: GenjutsuQuoteClaims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GenjutsuQuoteClaims; }
  catch { throw new GenjutsuError('Котировка повреждена. Запроси цену заново.', 409); }
  if (claims.version !== 1 || typeof claims.accountId !== 'string' || !claims.accountId
    || !uuid.test(claims.modelId)
    || !uuid.test(claims.videoId) || !Object.hasOwn(GENJUTSU_ENDPOINTS, claims.scenario)
    || !['480p', '720p', '1080p'].includes(claims.resolution)
    || !Number.isSafeInteger(claims.duration) || claims.duration < 4 || claims.duration > 30
    || !Number.isSafeInteger(claims.creditPrice) || claims.creditPrice < 1
    || !/^[a-f0-9]{64}$/.test(claims.pricingFingerprint)
    || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= Date.now()) {
    throw new GenjutsuError('Котировка устарела или некорректна. Запроси цену заново.', 409);
  }
  return claims;
}

export function quoteMatchesRequest(
  claims: GenjutsuQuoteClaims,
  input: { accountId: string; modelId: string; scenario: GenjutsuScenario; videoId: string; resolution: GenjutsuResolution; duration: number },
): boolean {
  return claims.accountId === input.accountId && claims.modelId === input.modelId
    && claims.scenario === input.scenario && claims.videoId === input.videoId
    && claims.resolution === input.resolution && claims.duration === input.duration;
}

export function validateGenjutsuReferences(scenario: GenjutsuScenario, images: string[], preset?: string) {
  if (new Set(images).size !== images.length) throw new GenjutsuError('Удали повторяющиеся фото.');
  const max = scenario === 'restyle' ? 5 : 8;
  if (images.length > max || (scenario !== 'restyle' && !images.length)) {
    throw new GenjutsuError(scenario === 'restyle' ? 'Разрешено до 5 фото персонажей.' : 'Нужно от 1 до 8 фото-референсов.');
  }
  if (scenario === 'restyle' && (!preset || !uuid.test(preset))) throw new GenjutsuError('Выбери доступный стиль.');
  if (scenario !== 'restyle' && preset !== undefined) throw new GenjutsuError('Этот сценарий не использует стиль Restyle.');
}

export function checkedVideoInfo(info: unknown, scenario: GenjutsuScenario) {
  const data = info as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[] };
  const video = data?.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(data?.format?.duration ?? video?.duration);
  if (!video || !Number.isFinite(duration) || duration < 4 || !video.width || !video.height) {
    throw new GenjutsuError('Нужно читаемое видео длительностью не менее 4 секунд.');
  }
  if (scenario === 'object-swap' && video.width * video.height < 409_600) {
    throw new GenjutsuError('Для замены объектов размер кадра должен быть не менее 409 600 пикселей (ширина × высота).');
  }
  return { duration: Math.ceil(Math.min(duration, 30)), width: video.width, height: video.height };
}

let activeProbes = 0;
export async function prepareGenjutsuMedia(ownerId: string, metadata: GenjutsuMetadata) {
  const ids = [metadata.videoId, ...metadata.imageIds];
  if (ids.some(id => !uuid.test(id))) throw new GenjutsuError('Некорректный файл.');
  const uploads = await db.select().from(meduhaUploads).where(and(
    eq(meduhaUploads.ownerId, ownerId), eq(meduhaUploads.finalized, true), inArray(meduhaUploads.id, ids),
  ));
  const video = uploads.find(upload => upload.id === metadata.videoId);
  if (!video || !['video/mp4', 'video/webm'].includes(video.contentType) || video.size > 100 * 1024 * 1024) {
    throw new GenjutsuError('Загрузи своё видео MP4 или WebM до 100 МБ и дождись завершения загрузки.');
  }
  for (const id of metadata.imageIds) {
    const image = uploads.find(upload => upload.id === id);
    if (!image || !['image/jpeg', 'image/png', 'image/webp'].includes(image.contentType) || image.size > 10 * 1024 * 1024) {
      throw new GenjutsuError('Фото должно быть твоим завершённым файлом JPEG, PNG или WebP до 10 МБ.');
    }
  }
  if (activeProbes >= 2) throw new GenjutsuError('Проверка файлов занята. Повтори немного позже.', 503);
  activeProbes++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'meduha-input-'));
    const path = join(directory, 'source');
    await pipeline(templateFile(video.id).createReadStream(), createWriteStream(path), { signal: AbortSignal.timeout(30_000) });
    let stdout: string;
    try {
      ({ stdout } = await exec('ffprobe', [
        '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', path,
      ], { timeout: 15_000, maxBuffer: 256 * 1024 }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new GenjutsuError('Проверка видео не настроена на сервере.', 503);
      throw new GenjutsuError('Не удалось прочитать видео. Попробуй другой MP4 или WebM.');
    }
    return checkedVideoInfo(JSON.parse(stdout), metadata.scenario);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    activeProbes--;
  }
}

export type GenjutsuStyle = { id: string; name: string; previewUrl: string };
let presets: { expires: number; items: GenjutsuStyle[] } | undefined;
export async function getGenjutsuStyles(): Promise<GenjutsuStyle[]> {
  if (presets && presets.expires > Date.now()) return presets.items;
  const response = await fetch('https://api.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/presets', {
    headers: { Authorization: `Key ${higgsfieldCredentials()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000), cache: 'no-store',
  });
  if (!response.ok) throw new GenjutsuError('Не удалось получить стили Higgsfield. Попробуй позже.', 503);
  const data = await response.json() as { model?: string; items?: { id?: string; name?: string; preview_url?: string }[] };
  if (data.model !== GENJUTSU_ENDPOINTS.restyle || !Array.isArray(data.items)
    || data.items.some(item => !item.id || !uuid.test(item.id) || !item.name || !item.preview_url?.startsWith('https://'))) {
    throw new GenjutsuError('Поставщик вернул некорректный список стилей.', 503);
  }
  const items = data.items.map(item => ({ id: item.id!, name: item.name!, previewUrl: item.preview_url! }));
  presets = { expires: Date.now() + 60_000, items };
  return items;
}

// Build only documented provider inputs. Internal metadata and signed URLs are
// never persisted together; sign immediately before the one-time submission.
export async function genjutsuProviderInput(
  input: { prompt: string; resolution: string; _genjutsu: GenjutsuMetadata },
  sign: (id: string) => Promise<string> = templateProviderUrl,
) {
  const metadata = input._genjutsu;
  if (GENJUTSU_ENDPOINTS[metadata.scenario] !== metadata.endpoint) throw new Error('Invalid Genjutsu dispatch endpoint');
  validateGenjutsuReferences(metadata.scenario, metadata.imageIds, metadata.presetId);
  const [video_url, ...image_urls] = await Promise.all([metadata.videoId, ...metadata.imageIds].map(id => sign(id)));
  return {
    prompt: input.prompt, resolution: input.resolution, video_url, image_urls,
    ...(metadata.scenario === 'restyle' ? { preset_id: metadata.presetId! } : {}),
  };
}
