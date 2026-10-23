import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { and, eq, inArray } from 'drizzle-orm';
import { db, meduhaUploads } from '@workspace/db';
import catalog from './photo-catalog.json';
import { templateProviderUrl } from './objectStorage';

export const photoModels = catalog.models;
export const photoFileFields = ['image_url', 'image_urls', 'item_image_urls'] as const;
export type PhotoMetadata = {
  catalogId: string;
  endpoint: string;
  parameters: Record<string, unknown>;
  references: Record<string, string[]>;
};
export class PhotoInputError extends Error {}
const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validators = new Map(photoModels.map(model => [model.id, ajv.compile({
  ...model.schema, additionalProperties: false,
})]));

export function validatePhotoInput(metadata: PhotoMetadata) {
  const model = photoModels.find(item => item.id === metadata.catalogId);
  if (!model || model.endpoint !== metadata.endpoint) throw new PhotoInputError('Неизвестная фотомодель.');
  const parameters = structuredClone(metadata.parameters);
  const properties = model.schema.properties as Record<string, any>;
  // URLs may only be supplied by our private upload flow, not by a client.
  for (const field of photoFileFields) {
    if (Object.hasOwn(parameters, field)) throw new PhotoInputError('Добавь референс через загрузку файла.');
  }
  for (const [field, ids] of Object.entries(metadata.references)) {
    if (!photoFileFields.includes(field as typeof photoFileFields[number]) || !properties[field]) {
      throw new PhotoInputError('Эта модель не принимает такой референс.');
    }
    if (!Array.isArray(ids) || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new PhotoInputError('Некорректный референс.');
    if (properties[field].type === 'array') {
      parameters[field] = ids.map(() => 'https://reference.example/image.png');
    } else {
      if (ids.length > 1) throw new PhotoInputError('Здесь можно добавить только одно фото.');
      if (ids.length) parameters[field] = 'https://reference.example/image.png';
    }
  }
  if (model.workflow && model.id !== 'workflows/ads-studio') {
    if (parameters.preset_id !== properties.preset_id?.default || parameters.enhance_prompt !== true || parameters.quality !== 'high') {
      throw new PhotoInputError('Для этого сценария нужен его пресет, улучшение описания и высокое качество.');
    }
  }
  // Higgsfield documents reference-image prompt processing as always enabled.
  if (model.id === 'higgsfield-ai/soul/v2/image-to-image' && parameters.enhance_prompt === false) {
    throw new PhotoInputError('Для SOUL 2 по фото обработка описания должна быть включена.');
  }
  const valid = validators.get(model.id)!;
  if (!valid(parameters)) {
    const detail = valid.errors?.slice(0, 3).map(e => `${e.instancePath || e.params.missingProperty || 'параметры'}: ${e.message}`).join('; ');
    throw new PhotoInputError(`Проверь настройки модели: ${detail}`);
  }
  for (const field of ['prompt', 'brief']) {
    if (typeof parameters[field] === 'string' && parameters[field].length > 8000) throw new PhotoInputError('Описание слишком длинное.');
  }
  if (typeof parameters.prompt === 'string' && !parameters.prompt.trim()) throw new PhotoInputError('Добавь описание.');
  return parameters;
}

export async function verifyPhotoReferences(accountId: string, metadata: PhotoMetadata) {
  const ids = [...new Set(Object.values(metadata.references).flat())];
  if (!ids.length) return;
  const rows = await db.select().from(meduhaUploads).where(and(
    inArray(meduhaUploads.id, ids), eq(meduhaUploads.ownerId, accountId), eq(meduhaUploads.finalized, true),
  ));
  if (rows.length !== ids.length || rows.some(row => !['image/jpeg', 'image/png', 'image/webp'].includes(row.contentType))) {
    throw new PhotoInputError('Фото не найдено в твоём аккаунте или загрузка не завершена.');
  }
}

export async function photoProviderInput(accountId: string, metadata: PhotoMetadata) {
  const parameters = validatePhotoInput(metadata);
  await verifyPhotoReferences(accountId, metadata);
  for (const [field, ids] of Object.entries(metadata.references)) {
    const urls = await Promise.all(ids.map(id => templateProviderUrl(id)));
    if (field.endsWith('_urls')) parameters[field] = urls;
    else if (urls.length) parameters[field] = urls[0];
  }
  return parameters;
}

// Key order must not affect idempotency, including nested appearance/color data.
export function stablePhotoInput(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stablePhotoInput).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stablePhotoInput(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function photoBatchSize(parameters: Record<string, unknown>) {
  const count = parameters.batch_size ?? 1;
  if (!Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > 8) throw new PhotoInputError('Некорректное количество изображений.');
  return Number(count);
}
