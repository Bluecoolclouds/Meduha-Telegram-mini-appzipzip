import { getTemplate, listTemplates } from '@workspace/api-client-react';
import type { TemplatePage, StudioTemplate } from '@workspace/api-client-react';
import { findExampleTemplate, findExamples } from './examples';
export { isExampleTemplate } from './examples';

export type InspirationTemplate = StudioTemplate;
export type { TemplatePage };
export type TemplateQuery = {
  query?: string;
  tag?: string;
  kind?: 'all' | 'photo' | 'video' | 'audio';
  cursor?: number;
  limit?: number;
  likedOnly?: boolean;
  savedOnly?: boolean;
};

export function templateMediaUrl(path: string): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  if (path.startsWith('/api/')) return path;
  return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\/+/, '')}`;
}

/** Real publications retain server cursors; labelled examples are added once. */
export async function getTemplatePage(options: TemplateQuery = {}, signal?: AbortSignal): Promise<TemplatePage> {
  const page = await listTemplates({
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    ...(options.tag?.trim() ? { tag: options.tag.trim() } : {}),
    kind: options.kind ?? 'all',
    scope: options.likedOnly ? 'liked' : options.savedOnly ? 'saved' : 'public',
    ...(options.cursor ? { cursor: options.cursor } : {}),
    limit: options.limit ?? 12,
  }, { signal, credentials: 'same-origin' });
  const examples = options.likedOnly || options.savedOnly || options.tag?.trim() ? [] : findExamples(options.query, options.kind ?? 'all');
  return {
    ...page,
    items: options.cursor === undefined ? [...page.items, ...examples] : page.items,
    total: page.total + examples.length,
  };
}

export function getPublicTemplate(id: string, signal?: AbortSignal): Promise<InspirationTemplate> {
  return getTemplate(id, { signal, credentials: 'same-origin' });
}

export function getExampleTemplate(id: string): InspirationTemplate | undefined {
  return findExampleTemplate(id);
}
