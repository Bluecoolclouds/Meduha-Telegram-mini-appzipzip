// Thin adapters over the generated client for the video catalogue.
import { createVideoGeneration as genCreate, getGetVideoCatalogQueryKey, useGetVideoCatalog } from '@workspace/api-client-react';
import type { VideoCatalog as GenCatalog, VideoCatalogModel, VideoFamily as GenFamily, VideoGenerationInput as GenInput } from '@workspace/api-client-react';

export type QuoteScenario = 'genjutsu' | 'object-swap' | 'restyle';
// quoteScenario is optional until codegen includes it everywhere.
export type VideoModel = VideoCatalogModel & { quoteScenario?: QuoteScenario | null };
export type VideoFamily = GenFamily;
export type VideoCatalog = Omit<GenCatalog, 'models'> & { models: VideoModel[] };
export type VideoGenerationInput = GenInput;

export const VIDEO_CATALOG_KEY = getGetVideoCatalogQueryKey();
const read = { credentials: 'same-origin' as const };
const mutateReq = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };

export class VideoApiError extends Error {
  status: number; uncertain: boolean; code: string | null;
  constructor(status: number, message: string, uncertain: boolean, code: string | null = null) { super(message); this.status = status; this.uncertain = uncertain; this.code = code; }
}

export function useVideoCatalog() {
  return useGetVideoCatalog<VideoCatalog>({ request: read, query: { queryKey: VIDEO_CATALOG_KEY, staleTime: 30_000 } });
}

export async function createVideoGeneration(data: VideoGenerationInput) {
  try { return await genCreate(data, mutateReq); }
  catch (e) {
    const err = e as { status?: unknown; data?: unknown };
    if (err && typeof err.status === 'number') {
      const status = err.status;
      const body = err.data as any;
      const raw = body?.error ?? body?.message;
      const msg = typeof raw === 'string' ? raw : typeof raw?.message === 'string' ? raw.message : '';
      const code = typeof body?.code === 'string' ? body.code : typeof raw?.code === 'string' ? raw.code : null;
      throw new VideoApiError(status, msg || `Ошибка сервера (${status})`, status >= 500 || status === 408, code);
    }
    throw new VideoApiError(0, 'Связь прервалась до ответа сервера', true);
  }
}

export function videoErrorText(e: unknown): string {
  if (e instanceof VideoApiError) {
    if (e.code === 'QUOTE_REQUIRED' || /QUOTE_REQUIRED/.test(e.message)) return 'Для этой модели цена считается после проверки видео. Открой редактор с расчётом цены';
    if (e.status === 401) return 'Нужен вход через Telegram: сессия не найдена или истекла';
    if (e.status === 402) return `Не хватает кредитов. ${e.message}`;
    if (e.status === 403) return `Нет доступа. ${e.message}`;
    if (e.status === 409) return `Конфликт: ${e.message}. Цена или доступность модели могли измениться`;
    if (e.uncertain) return `Ответ не получен (${e.message})`;
    return e.message;
  }
  return e instanceof Error ? e.message : 'Неизвестная ошибка';
}

export const videoModelHref = (id: string) => `/create?type=video&videoModel=${encodeURIComponent(id)}`;
export const quoteHref = (s: QuoteScenario) => `/create?type=video&scenario=${encodeURIComponent(s)}`;
export const providerOf = (m: { id: string }) => m.id.split('/')[0];
const providerNames: Record<string, string> = { bytedance: 'ByteDance', kling: 'Kling', 'kling-ai': 'Kling', google: 'Google', openai: 'OpenAI', minimax: 'MiniMax', alibaba: 'Alibaba', wan: 'Wan', lightricks: 'Lightricks', higgsfield: 'Higgsfield', 'higgsfield-ai': 'Higgsfield', xai: 'xAI', pixverse: 'PixVerse', runway: 'Runway', luma: 'Luma', vidu: 'Vidu', workflows: 'Сценарий' };
export const providerLabel = (p: string) => providerNames[p] ?? p.replace(/(^|-)([a-z])/g, (_, s, c) => `${s ? ' ' : ''}${c.toUpperCase()}`);
const arts = ['portrait', 'fashion', 'astronaut', 'mountain', 'car', 'city', 'perfume', 'wave'];
export const familyArt = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arts[h % arts.length]; };
