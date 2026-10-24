import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, meduhaDrafts, meduhaTemplates, meduhaUploads } from '@workspace/db';
import { CreateTemplateRecipeDraftBody, type TemplateRecipe, type TemplateRecipeView } from '@workspace/api-zod';
import { photoModels, validatePhotoInput, photoFileFields } from './photo';
import { videoModels, validateVideoInput, videoFileFields } from './video';
import { templateFile } from './objectStorage';
import { motionAssets, motionExample } from './motion-example';
import { DOCUMENT_TYPES } from './document-files';
const RecipeSchema = CreateTemplateRecipeDraftBody.shape.recipe;

export class RecipeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function checkedRecipe(value: unknown): TemplateRecipe {
  const parsed = RecipeSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(value).length > 65536) throw new RecipeError(400, 'Некорректные параметры шаблона.');
  const recipe = parsed.data;
  const canonical: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(recipe.references)) {
    const path = key.startsWith('/') ? key : `/${key}`;
    if (Object.hasOwn(canonical, path)) throw new RecipeError(400, 'Референс указан дважды.');
    canonical[path] = ids;
  }
  recipe.references = canonical;
  const model = (recipe.kind === 'photo' ? photoModels : videoModels).find(m => m.id === recipe.catalogId);
  if (!model) throw new RecipeError(400, 'Модель или режим шаблона не поддерживается.');
  const metadata = { catalogId: model.id, endpoint: model.endpoint, parameters: recipe.parameters,
    references: recipe.kind === 'photo' ? Object.fromEntries(Object.entries(recipe.references).map(([k, v]) => [k.slice(1), v])) : recipe.references };
  try {
    if (recipe.kind === 'photo') validatePhotoInput(metadata);
    else validateVideoInput(metadata);
  } catch (e) { throw new RecipeError(400, e instanceof Error ? e.message : 'Проверь материалы шаблона.'); }
  return recipe;
}
const idsOf = (recipe: TemplateRecipe) => [...new Set(Object.values(recipe.references).flat())];
export async function recipeUploads(recipe: TemplateRecipe) {
  const ids = idsOf(recipe);
  if (!ids.length) return [];
  const uploads = await db.select().from(meduhaUploads).where(and(inArray(meduhaUploads.id, ids), eq(meduhaUploads.finalized, true)));
  if (uploads.length !== ids.length) throw new RecipeError(400, 'Материалы шаблона отсутствуют или не завершена загрузка.');
  if (uploads.reduce((n, f) => n + f.size, 0) > 512 * 1024 * 1024) throw new RecipeError(400, 'Материалы шаблона превышают 512 МБ.');
  const model = (recipe.kind === 'photo' ? photoModels : videoModels).find(m => m.id === recipe.catalogId)!;
  const fields = recipe.kind === 'video' ? videoFileFields(model as typeof videoModels[number]) : null;
  for (const [path, list] of Object.entries(recipe.references)) {
    const field = fields?.find(f => f.path === (path.startsWith('/') ? path : `/${path}`));
    const imageField = photoFileFields.find(k => path === k || path === `/${k}`);
    for (const id of list) {
      const type = uploads.find(f => f.id === id)!.contentType;
      const kind = recipe.kind === 'photo' && imageField ? 'image' : field?.kind;
      if (kind && kind !== 'document' && !type.startsWith(`${kind}/`)) throw new RecipeError(400, 'Тип референса не соответствует полю модели.');
      if (kind === 'document' && !DOCUMENT_TYPES.includes(type)) throw new RecipeError(400, 'Это поле принимает документ.');
    }
  }
  return uploads;
}
export async function validateOwnedRecipe(value: unknown, owners: string[], kind: string, prompt: string) {
  if (value == null) return null;
  const recipe = checkedRecipe(value);
  if (recipe.kind !== kind || recipe.parameters.prompt !== prompt) throw new RecipeError(400, 'Тип и промпт рецепта должны совпадать с публикацией.');
  const uploads = await recipeUploads(recipe);
  if (uploads.some(f => !owners.includes(f.ownerId))) throw new RecipeError(403, 'Для шаблона можно использовать только свои материалы.');
  return recipe;
}
type FileRecord = { id: string; size: number; contentType: string; url: string };
function view(id: string, title: string, sourceTemplateId: string | null, recipe: TemplateRecipe, uploads: FileRecord[]): TemplateRecipeView {
  const files = Object.fromEntries(Object.entries(recipe.references).map(([path, ids]) => [path, ids.map(id => {
    const file = uploads.find(f => f.id === id);
    if (!file) throw new RecipeError(400, 'Референс недоступен.');
    return file;
  })]));
  return { id, title, sourceTemplateId, recipe, files };
}
const uploadRecords = (uploads: Awaited<ReturnType<typeof recipeUploads>>): FileRecord[] => uploads.map(f => ({
  id: f.id, size: f.size, contentType: f.contentType, url: `/api/meduha/media/${f.id}`,
}));
export async function sourceRecipe(id: string, accountId?: string) {
  if (id === motionExample.id) {
    const recipe = checkedRecipe(motionExample.recipe);
    const files = Object.entries(motionAssets).map(([name, f]) => ({ ...f, url: `/api/meduha/example-media/${name}` }));
    return view(id, motionExample.title, id, recipe, files);
  }
  const [row] = await db.select().from(meduhaTemplates).where(eq(meduhaTemplates.id, id));
  if (!row || (row.status !== 'published' && row.ownerId !== accountId) || !row.recipe) throw new RecipeError(404, 'Повторяемый шаблон не найден.');
  const recipe = checkedRecipe(row.recipe);
  return view(row.id, row.title, row.id, recipe, uploadRecords(await recipeUploads(recipe)));
}
export async function savedRecipe(id: string, ownerId: string): Promise<TemplateRecipeView> {
  const [row] = await db.select().from(meduhaDrafts).where(and(eq(meduhaDrafts.id, id), eq(meduhaDrafts.userId, ownerId)));
  if (!row?.payload.recipe) throw new RecipeError(404, 'Ваш черновик шаблона не найден.');
  const recipe = checkedRecipe(row.payload.recipe);
  const uploads = await recipeUploads(recipe);
  if (uploads.some(f => f.ownerId !== ownerId)) throw new RecipeError(404, 'Материалы черновика недоступны.');
  return view(id, row.payload.title, row.payload.recipeSourceId ?? null, recipe, uploadRecords(uploads));
}
function payload(title: string, recipe: TemplateRecipe, source: string | null) {
  return { title, type: recipe.kind, prompt: String(recipe.parameters.prompt ?? ''), model: recipe.catalogId,
    style: '', ratio: String(recipe.parameters.aspect_ratio ?? ''), duration: String(recipe.parameters.duration ?? ''),
    recipe, recipeSourceId: source };
}
export async function saveRecipeDraft(title: string, value: unknown, ownerId: string) {
  const recipe = checkedRecipe(value);
  await validateOwnedRecipe(recipe, [ownerId], recipe.kind, String(recipe.parameters.prompt ?? ''));
  const id = `repeat-${randomUUID()}`;
  await db.insert(meduhaDrafts).values({ id, userId: ownerId, payload: payload(title, recipe, null) });
  return savedRecipe(id, ownerId);
}
export async function repeatRecipe(sourceId: string, requestId: string, ownerId: string,
  copy = async (from: string, to: string) => { await templateFile(from).copy(templateFile(to), { preconditionOpts: { ifGenerationMatch: 0 } }); },
  remove = async (id: string) => { await templateFile(id).delete({ ignoreNotFound: true }); },
) {
  const id = `repeat-${requestId}`;
  const created: string[] = [];
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`template-repeat:${ownerId}:${requestId}`}))`);
      const [previous] = await tx.select().from(meduhaDrafts).where(and(eq(meduhaDrafts.id, id), eq(meduhaDrafts.userId, ownerId)));
      if (previous) {
        if (previous.payload.recipeSourceId !== sourceId) throw new RecipeError(409, 'Этот запрос уже использован для другого шаблона.');
        return;
      }
      if (sourceId !== motionExample.id) {
        const [source] = await tx.select().from(meduhaTemplates).where(eq(meduhaTemplates.id, sourceId)).for('share');
        if (!source || (source.status !== 'published' && source.ownerId !== ownerId)) throw new RecipeError(404, 'Шаблон больше не опубликован.');
      }
      const [rate] = await tx.select({ count: sql<number>`count(*)::int` }).from(meduhaDrafts).where(and(
        eq(meduhaDrafts.userId, ownerId), sql`${meduhaDrafts.id} like 'repeat-%'`,
        sql`${meduhaDrafts.updatedAt} > now() - interval '1 hour'`,
      ));
      if (rate.count >= 20) throw new RecipeError(429, 'Не больше 20 копий шаблонов в час.');
      const source = await sourceRecipe(sourceId, ownerId);
      const recipe = structuredClone(source.recipe);
      const copied = new Map<string, string>();
      for (const [path, list] of Object.entries(recipe.references)) {
        const next: string[] = [];
        for (const original of list) {
          let replacement = copied.get(original);
          if (!replacement) {
            const file = source.files[path].find(f => f.id === original)!;
            replacement = randomUUID(); created.push(replacement);
            await copy(original, replacement);
            await tx.insert(meduhaUploads).values({ id: replacement, ownerId, size: file.size, contentType: file.contentType, finalized: true });
            copied.set(original, replacement);
          }
          next.push(replacement);
        }
        recipe.references[path] = next;
      }
      await tx.insert(meduhaDrafts).values({ id, userId: ownerId, payload: payload(source.title, recipe, sourceId) });
    });
  } catch (e) {
    await Promise.allSettled(created.map(remove));
    throw e;
  }
  return savedRecipe(id, ownerId);
}
