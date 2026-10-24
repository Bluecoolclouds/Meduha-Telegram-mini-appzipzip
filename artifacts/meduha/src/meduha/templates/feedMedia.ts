const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
/** Feed cards never use original media as an error fallback. The full viewer
 * and downloads keep using the untouched original URLs in the template. */
export function feedMediaUrl(id: string, variant: 'thumb' | 'preview') {
  return `${BASE}/api/meduha/feed-media/${encodeURIComponent(id)}/${variant}`;
}
