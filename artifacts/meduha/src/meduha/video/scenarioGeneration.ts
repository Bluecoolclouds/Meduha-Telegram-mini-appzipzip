import type { VideoScenario } from './scenarios';
import { unwrap, validate, type Schema } from './videoSchema.ts';

const models: Record<string, string> = {
  'text-to-video': 'bytedance/seedance-2.5/text-to-video',
  'image-to-video': 'bytedance/seedance-2.5/image-to-video',
  cinema: 'higgsfield/cinema-studio/4.0',
  'ai-blogger': 'bytedance/seedance-2.5/reference-to-video',
  katana: 'bytedance/seedance-2.5/video-edit',
  'content-factory': 'bytedance/seedance-2.5/text-to-video',
};

export const videoScenarioModel = (id: string): string | null => models[id] ?? null;
export const isDirectVideoScenario = (id: string): boolean => ['text-to-video', 'image-to-video', 'cinema'].includes(id);

/** The same existing examples apply to the standard, light and workflow variants. */
export function genjutsuPreviewScenario(modelId: string): 'genjutsu' | 'object-swap' | 'restyle' | null {
  if (modelId === 'workflows/genjutsu') return 'genjutsu';
  if (modelId === 'workflows/genjutsu/object-swap') return 'object-swap';
  if (/^higgsfield\/genjutsu(?:-light)?\/motion-transfer\/v1\.0$/.test(modelId)) return 'genjutsu';
  if (/^higgsfield\/genjutsu(?:-light)?\/object-swap\/v1\.0$/.test(modelId)) return 'object-swap';
  return modelId === 'higgsfield/genjutsu/restyle/v1.0' ? 'restyle' : null;
}

export type VideoScenarioSeed = { prompt?: string; ratio?: string; duration?: string; draftId?: string };
export type VideoScenarioContext = VideoScenarioSeed & { scenario: VideoScenario; prompt: string };

export function videoScenarioGenerationHref(scenario: VideoScenario, seed: VideoScenarioSeed = {}, modelId = videoScenarioModel(scenario.id)): string {
  if (!modelId) throw new Error('У этого сценария нет обычного видеогенератора');
  const query = new URLSearchParams({
    type: 'video', videoModel: modelId, videoIdea: scenario.id,
    ideaPrompt: seed.prompt ?? scenario.prompt,
  });
  if (seed.ratio) query.set('ideaRatio', seed.ratio);
  if (seed.duration) query.set('ideaDuration', seed.duration);
  if (seed.draftId) query.set('videoDraft', seed.draftId);
  return `/create?${query.toString()}`;
}

/** Only seed settings the exact mode accepts. Never change its schema or truncate duration. */
export function videoScenarioParameters(context: VideoScenarioContext, schema: Schema): { parameters: Record<string, unknown>; ignored: string[] } {
  const parameters: Record<string, unknown> = {};
  const ignored: string[] = [];
  if (schema.properties?.prompt) parameters.prompt = context.prompt;
  for (const [key, raw, label] of [
    ['aspect_ratio', context.ratio, 'Формат кадра'],
    ['duration', context.duration, 'Длительность'],
  ] as const) {
    if (!raw) continue;
    const property = schema.properties?.[key];
    if (!property) { ignored.push(label); continue; }
    const { s } = unwrap(property, schema);
    const value = key === 'duration' && (s.type === 'integer' || s.type === 'number')
      ? Number(raw.replace(/\s*сек.*$/, '')) : key === 'duration' ? raw.replace(/\s*сек.*$/, '') : raw;
    if ((typeof value === 'number' && !Number.isFinite(value)) || validate(property, value, schema, label)) ignored.push(label);
    else parameters[key] = value;
  }
  return { parameters, ignored };
}

export function videoScenarioNotice(id: string): string {
  if (id === 'katana') return 'Это альтернативная обработка видео через выбранную модель, не Katana и не автоматическое повторение монтажа. Публичный REST endpoint Катаны в каталоге не найден.';
  if (id === 'content-factory') return 'Отдельный этап: создание одного ролика по брифу. Контент-план не превращается автоматически в серию видео; пакетная генерация и автопубликация не подключены.';
  if (id === 'ai-blogger') return 'Отдельный этап: ролик с подготовленным персонажем. Добавь фото персонажа в поля референсов выбранной модели. Это не автоматическая цепочка создания персонажа и серии публикаций.';
  return 'Описание можно изменить, а модель — выбрать ниже. Настройки и загруженные исходники сохраняются отдельно для каждого режима этого сценария.';
}
