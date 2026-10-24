// Typed fetch adapter until @workspace/api-client-react generates the recipe endpoints.
// Names are prefixed so they never collide with the future generated exports.
import type { Recipe, RecipeView } from './model';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export class RecipeApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function call<T>(path: string, init?: { method?: 'POST'; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${BASE}/api/meduha${path}`, {
    method: init?.method ?? 'GET', credentials: 'same-origin', signal: init?.signal,
    headers: init?.method ? { 'Content-Type': 'application/json', 'X-Meduha-Request': '1' } : undefined,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RecipeApiError((data && typeof data.error === 'string' && data.error) || (data && typeof data.message === 'string' && data.message) || `Ошибка ${res.status}`, res.status);
  return data as T;
}
export const fetchTemplateRecipe = (id: string, signal?: AbortSignal) => call<RecipeView>(`/template-recipes/${encodeURIComponent(id)}`, { signal });
export const postTemplateRepeat = (id: string, requestId: string) => call<RecipeView>(`/templates/${encodeURIComponent(id)}/repeat`, { method: 'POST', body: { requestId } });
export const fetchTemplateRepeat = (id: string, signal?: AbortSignal) => call<RecipeView>(`/template-repeats/${encodeURIComponent(id)}`, { signal });
export const postRecipeDraft = (title: string, recipe: Recipe) => call<RecipeView>('/template-recipe-drafts', { method: 'POST', body: { title, recipe } });
