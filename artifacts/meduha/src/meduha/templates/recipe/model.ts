/** Pure, framework-free helpers for reusable Community template recipes. */
export type RecipeKind = 'photo' | 'video';
export type Recipe = { version: 1; kind: RecipeKind; catalogId: string; parameters: Record<string, unknown>; references: Record<string, string[]> };
export type RecipeFile = { id: string; url: string; contentType: string; size: number };
export type RecipeView = { id: string; title: string; sourceTemplateId: string | null; recipe: Recipe; files: Record<string, RecipeFile[]> };
export type GenjutsuMode = 'genjutsu' | 'object-swap' | 'restyle';

export const GENJUTSU_CATALOG: Record<GenjutsuMode, string> = {
  genjutsu: 'higgsfield/genjutsu/motion-transfer/v1.0',
  'object-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  restyle: 'higgsfield/genjutsu/restyle/v1.0',
};
export const genjutsuModeOf = (catalogId: string): GenjutsuMode | null =>
  (Object.keys(GENJUTSU_CATALOG) as GenjutsuMode[]).find(k => GENJUTSU_CATALOG[k] === catalogId) ?? null;

/** Canonical Genjutsu pointers mirror the upstream payload (video_url, image_urls). */
export const GJ_VIDEO = '/video_url';
export const GJ_IMAGES = '/image_urls';
const pick = (refs: Record<string, string[]>, keys: string[]) => { for (const k of keys) if (refs[k]?.length) return k; return null; };
export const genjutsuVideoKey = (refs: Record<string, string[]>) => pick(refs, [GJ_VIDEO, '/video', '/videoId']);
export const genjutsuImagesKey = (refs: Record<string, string[]>) => pick(refs, [GJ_IMAGES, '/images', '/imageIds']);

export const isRepeatId = (id: string | null | undefined): id is string => !!id && /^repeat-[0-9a-f-]{36}$/i.test(id);

export function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== 'object') return false;
  const r = value as Recipe;
  return r.version === 1 && (r.kind === 'photo' || r.kind === 'video') && typeof r.catalogId === 'string' && !!r.catalogId
    && !!r.parameters && typeof r.parameters === 'object' && !!r.references && typeof r.references === 'object';
}

/** Exact editor route for a recipe; `param` is template=<id> or repeat=<id>. */
export function recipeHref(recipe: Recipe, param: { template?: string; repeat?: string }): string {
  const q = new URLSearchParams();
  q.set('type', recipe.kind);
  const gj = recipe.kind === 'video' ? genjutsuModeOf(recipe.catalogId) : null;
  if (gj) q.set('scenario', gj);
  else q.set(recipe.kind === 'photo' ? 'photoModel' : 'videoModel', recipe.catalogId);
  if (param.repeat) q.set('repeat', param.repeat);
  else if (param.template) q.set('template', param.template);
  return `/create?${q}`;
}

/** Photo editor stores refs by field name; recipes use JSON pointers. */
export const pointerOf = (field: string) => `/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`;
export const fieldOfPointer = (pointer: string) => pointer.startsWith('/') && !pointer.slice(1).includes('/') ? pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~') : null;

export const repeatStoreSuffix = (account: string, repeatId: string) => `${account}.${repeatId}`;
export const intentStorageKey = (account: string, templateId: string) => `meduha.template-repeat-intent.v1.${account}.${templateId}`;
export const fileKindOf = (contentType: string): 'image' | 'video' | 'audio' | 'document' =>
  contentType.startsWith('image/') ? 'image' : contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'document';
