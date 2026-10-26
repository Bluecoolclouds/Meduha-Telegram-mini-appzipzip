import manifest from '@workspace/studio-examples/feed-media.json';

const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
/** Feed cards never use original media as an error fallback. The full viewer
 * and downloads keep using the untouched original URLs in the template. */
export function feedMediaUrl(id: string, variant: 'thumb' | 'preview') {
  const entries: Record<string, Partial<Record<'thumb' | 'preview', { sha256: string }>>> = manifest;
  const asset = Object.hasOwn(entries, id) ? entries[id][variant] : undefined;
  return `${BASE}/api/meduha/feed-media/${encodeURIComponent(id)}/${variant}${asset ? `?v=${asset.sha256}` : ''}`;
}
