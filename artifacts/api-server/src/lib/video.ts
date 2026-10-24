import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { and, eq, inArray } from 'drizzle-orm';
import { db, meduhaUploads } from '@workspace/db';
import catalog from './video-catalog.json';
import { validateProviderUrl, templateProviderUrl } from './objectStorage';
import { DOCUMENT_TYPES } from './document-files';

type Schema = Record<string, any>;
export type VideoFileField = { path: string; kind: 'image' | 'video' | 'audio' | 'document'; array: boolean };
export type VideoModel = {
  id: string; familyId: string; name: string; mode: string; endpoint: string; source: string;
  description: string; workflow: boolean; schema: Schema; outputSchema: Schema;
};
export const videoModels = catalog.models as VideoModel[];
export const videoFamilies = catalog.families;
export type VideoMetadata = {
  catalogId: string; endpoint: string; parameters: Record<string, unknown>; references: Record<string, string[]>;
};
export class VideoInputError extends Error {}
const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validators = new Map(videoModels.map(model => [model.id, ajv.compile({ ...model.schema, additionalProperties: false })]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape = (part: string) => part.replaceAll('~', '~0').replaceAll('/', '~1');
const parts = (pointer: string) => pointer.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const mimeTypes: Record<VideoFileField['kind'], readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav'],
  document: DOCUMENT_TYPES,
};
function resolve(schema: Schema, root: Schema): Schema {
  if (schema.$ref?.startsWith('#/')) return schema.$ref.slice(2).split('/').reduce((s: any, k: string) => s?.[k], root) ?? {};
  return schema;
}
export function videoFileFields(model: VideoModel): VideoFileField[] {
  const fields: VideoFileField[] = [];
  const walk = (raw: Schema, path: string, key: string) => {
    const s = resolve(raw, model.schema);
    if (key === 'file_url' || /(?:image|frame|video|audio)_urls?$/.test(key)) {
      fields.push({ path, kind: key === 'file_url' ? 'document' : key.includes('audio') ? 'audio' : key.includes('video') ? 'video' : 'image',
        array: s.type === 'array' || Array.isArray(s.type) && s.type.includes('array') });
      return;
    }
    for (const [name, child] of Object.entries<Schema>(s.properties ?? {})) walk(child, `${path}/${escape(name)}`, name);
    if (s.items) walk(s.items, `${path}/*`, key);
  };
  walk(model.schema, '', '');
  return fields;
}
function atPath(value: any, pointer: string) {
  return parts(pointer).reduce((v, k) => v?.[k], value);
}
function putPath(value: Record<string, unknown>, pointer: string, data: unknown) {
  const keys = parts(pointer);
  if (keys.some(k => forbidden.has(k))) throw new VideoInputError('Некорректный путь референса.');
  let target: any = value;
  for (const key of keys.slice(0, -1)) {
    if (!target || !Object.hasOwn(target, key) || typeof target[key] !== 'object' || target[key] === null) throw new VideoInputError('Сначала добавь группу параметров референса.');
    target = target[key];
  }
  target[keys.at(-1)!] = data;
}
function fieldFor(pointer: string, model: VideoModel) {
  const path = pointer.startsWith('/') ? pointer : `/${escape(pointer)}`;
  const actual = parts(path);
  const field = videoFileFields(model).find(f => {
    const expected = parts(f.path);
    return expected.length === actual.length && expected.every((p, i) => p === actual[i] || p === '*' && /^(0|[1-9]\d*)$/.test(actual[i]));
  });
  if (!field || actual.some(p => forbidden.has(p))) throw new VideoInputError('Модель не принимает этот референс.');
  return { path, field };
}
function expandedPaths(parameters: Record<string, unknown>, pointer: string): string[] {
  const keys = parts(pointer);
  const walk = (node: any, i: number, path: string): string[] => {
    if (i === keys.length) return [path];
    if (keys[i] === '*') return Array.isArray(node) ? node.flatMap((item, index) => walk(item, i + 1, `${path}/${index}`)) : [];
    return walk(node?.[keys[i]], i + 1, `${path}/${escape(keys[i])}`);
  };
  return walk(parameters, 0, '');
}
export function validateVideoInput(metadata: VideoMetadata) {
  const model = videoModels.find(m => m.id === metadata.catalogId && m.endpoint === metadata.endpoint);
  if (!model) throw new VideoInputError('Неизвестная видеомодель.');
  const parameters = structuredClone(metadata.parameters);
  for (const f of videoFileFields(model)) for (const path of expandedPaths(parameters, f.path)) {
    if (atPath(parameters, path) != null) throw new VideoInputError('Добавь референс через загрузку файла, а не ссылкой.');
  }
  const seen = new Set<string>();
  for (const [key, ids] of Object.entries(metadata.references)) {
    const { path, field } = fieldFor(key, model);
    if (seen.has(path)) throw new VideoInputError('Референс указан дважды.');
    seen.add(path);
    if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => !UUID.test(id))) throw new VideoInputError('Некорректный файл-референс.');
    if (!field.array && ids.length > 1) throw new VideoInputError('Здесь нужен один файл.');
    if (ids.length) putPath(parameters, path, field.array ? ids.map(() => 'https://reference.example/input') : 'https://reference.example/input');
  }
  // Wan documents this rule in its field description, not in JSON Schema.
  // Upstream element IDs are private resources of the shared provider account,
  // not owned Meduha uploads. There is no per-user element mapping yet.
  if (Array.isArray(parameters.elements) && parameters.elements.length) {
    throw new VideoInputError('Элементы Higgsfield пока не привязаны к вашему аккаунту Meduha. Используйте свои загруженные референсы.');
  }
  if (['alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0-prime/reference-to-video'].includes(model.id)
    && (parameters.file_url || parameters.link_url)) {
    if (parameters.prompt_extend === false) throw new VideoInputError('Для документа или веб-ссылки Wan улучшение описания должно быть включено.');
    parameters.prompt_extend = true;
  }
  const valid = validators.get(model.id)!;
  if (!valid(parameters)) throw new VideoInputError(`Проверь настройки: ${valid.errors?.slice(0, 3).map(e => `${e.instancePath || e.params.missingProperty || 'параметры'}: ${e.message}`).join('; ')}`);
  if (typeof parameters.prompt === 'string' && (!parameters.prompt.trim() || parameters.prompt.length > 8000)) throw new VideoInputError('Описание должно содержать от 1 до 8000 символов.');
  return parameters;
}
export async function verifyVideoReferences(accountId: string, metadata: VideoMetadata) {
  const model = videoModels.find(m => m.id === metadata.catalogId)!;
  const ids = [...new Set(Object.values(metadata.references).flat())];
  if (ids.length > 100) throw new VideoInputError('Слишком много референсов.');
  if (ids.length) {
    const rows = await db.select().from(meduhaUploads).where(and(inArray(meduhaUploads.id, ids), eq(meduhaUploads.ownerId, accountId), eq(meduhaUploads.finalized, true)));
    if (rows.length !== ids.length) throw new VideoInputError('Референс не найден в твоём аккаунте или загрузка не завершена.');
    for (const [key, refs] of Object.entries(metadata.references)) {
      const { field } = fieldFor(key, model);
      if (refs.some(id => {
        const row = rows.find(r => r.id === id)!;
        return !mimeTypes[field.kind].includes(row.contentType) || (field.kind === 'document' && row.size > 10 * 1024 * 1024);
      })) throw new VideoInputError('Формат или размер файла не подходит для этого поля.');
    }
  }
  // Public website references are a documented parameter, not media uploads.
  if (metadata.parameters.link_url) {
    try { await validateProviderUrl(String(metadata.parameters.link_url)); }
    catch { throw new VideoInputError('Нужна публичная HTTPS-ссылка на веб-страницу.'); }
  }
}
export async function videoProviderInput(accountId: string, metadata: VideoMetadata) {
  const parameters = validateVideoInput(metadata);
  await verifyVideoReferences(accountId, metadata);
  const model = videoModels.find(m => m.id === metadata.catalogId)!;
  for (const [key, ids] of Object.entries(metadata.references)) {
    if (!ids.length) continue;
    const { path, field } = fieldFor(key, model);
    const urls = await Promise.all(ids.map(id => templateProviderUrl(id)));
    putPath(parameters, path, field.array ? urls : urls[0]);
  }
  return parameters;
}
