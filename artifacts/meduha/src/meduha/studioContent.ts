/**
 * Pure helpers for admin-curated studio content overrides.
 * Overrides only change display/navigation: titles, descriptions, covers and visibility.
 * They never touch prompts, models, prices or provider contracts.
 */
export type ContentOverride = {
  key: string;
  title: string;
  description: string;
  cover: string | null;
  enabled: boolean;
  revision: number;
  updatedAt: string;
};
export type ContentMap = ReadonlyMap<string, ContentOverride>;

export const photoIdeaKey = (id: string) => `photo-idea:${id}`;
export const videoScenarioKey = (id: string) => `video-scenario:${id}`;
export const photoExampleKey = (modelId: string) => `photo-example:${modelId}`;

export const emptyContentMap: ContentMap = new Map();

export function toContentMap(list: readonly ContentOverride[] | null | undefined): ContentMap {
  const map = new Map<string, ContentOverride>();
  if (!Array.isArray(list)) return map;
  for (const row of list) if (row && typeof row.key === 'string') map.set(row.key, row);
  return map;
}

export const isContentEnabled = (map: ContentMap, key: string) => map.get(key)?.enabled !== false;

/** Non-empty override cover, or null when the default should be used. */
export function contentCover(map: ContentMap, key: string): string | null {
  const cover = map.get(key)?.cover;
  return typeof cover === 'string' && cover.trim() ? cover.trim() : null;
}

/** Root-relative app routes need the deployment base; absolute HTTPS stays as is. */
export function resolveContentUrl(url: string, base: string): string {
  return url.startsWith('/') ? `${base.replace(/\/$/, '')}${url}` : url;
}

type Titled = { id: string; title: string; subtitle: string };

/** Apply title/description overrides to one item (empty override fields keep defaults). */
export function applyContent<T extends Titled>(item: T, map: ContentMap, keyOf: (id: string) => string): T {
  const row = map.get(keyOf(item.id));
  if (!row) return item;
  const title = row.title.trim() || item.title;
  // An empty description is a deliberate clear; only the cover falls back when null.
  const subtitle = row.description.trim();
  return title === item.title && subtitle === item.subtitle ? item : { ...item, title, subtitle };
}

/** Drop disabled items and apply overrides, preserving the default order. */
export function mergeContent<T extends Titled>(items: readonly T[], map: ContentMap, keyOf: (id: string) => string): T[] {
  return items.filter(item => isContentEnabled(map, keyOf(item.id))).map(item => applyContent(item, map, keyOf));
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MEDIA_UUID = /^\/api\/meduha\/studio-content-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAMPLE_MEDIA = /^\/api\/meduha\/example-media\/[A-Za-z0-9._/-]+$/;
const LOCAL_IMAGE = /^\/images\/[A-Za-z0-9._/-]+$/;

/** Mirrors the server cover policy. Returns a problem message, or null when acceptable. Empty = default. */
export function coverProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 2048) return 'Адрес обложки слишком длинный.';
  if (v.startsWith('/')) {
    if (v.includes('..') || v.includes('//')) return 'Недопустимый путь.';
    if (MEDIA_UUID.test(v) || EXAMPLE_MEDIA.test(v) || LOCAL_IMAGE.test(v)) return null;
    return 'Разрешены только загруженные файлы студии, /api/meduha/example-media/… и /images/….';
  }
  let url: URL;
  try { url = new URL(v); } catch { return 'Это не похоже на адрес изображения.'; }
  if (url.protocol !== 'https:') return 'Внешняя обложка должна начинаться с https://.';
  if (url.username || url.password) return 'Адрес не должен содержать логин или пароль.';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || IPV4.test(host) || host.includes(':') || host.startsWith('[')) return 'IP-адреса и локальные хосты запрещены.';
  if (!host.includes('.')) return 'Укажи полное доменное имя.';
  return null;
}
