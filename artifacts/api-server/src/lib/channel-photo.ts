import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, meduhaAiChannels, meduhaAiModels } from '@workspace/db';
import { AiChannelError, channelBinding, channelConfigured, channelImageSchema } from './ai-channels';
import type { PhotoMetadata } from './photo';

export type ChannelPhotoBinding = { channelId: string; upstreamId: string; binding: string };
export function channelPhotoProtocol(schema: unknown): schema is { protocol: string; binding: string } {
  return !!schema && typeof schema === 'object' && 'protocol' in schema && schema.protocol === 'openai-images-v1' && 'binding' in schema && typeof schema.binding === 'string';
}
export const channelPhotoPriceFingerprint = (binding: string, price: number) => createHash('sha256').update(JSON.stringify(['channel-photo-fixed-v1', binding, price])).digest('hex');
export async function loadChannelPhoto(modelId: string, requireEnabled = true) {
  const [row] = await db.select({ model: meduhaAiModels, channel: meduhaAiChannels }).from(meduhaAiModels)
    .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId)).where(eq(meduhaAiModels.id, modelId));
  if (!row || row.model.kind !== 'photo' || !channelPhotoProtocol(row.model.providerSchema)
    || row.model.providerSchema.binding !== channelBinding(row.channel, row.model.upstreamId)) throw new AiChannelError('Протокол модели не подтверждён для этого канала. Повторно проверь и импортируй модель.');
  if (requireEnabled && (!row.model.enabled || !row.channel.enabled || row.model.creditPrice <= 0 || !channelConfigured(row.channel))) {
    throw new AiChannelError('Канал или модель отключены, нет цены либо ключа.');
  }
  return { ...row, binding: row.model.providerSchema.binding };
}
export function channelPhotoMetadata(modelId: string, upstreamId: string, parameters: Record<string, unknown>, references: Record<string, string[]>): PhotoMetadata {
  if (Object.keys(parameters).length !== 1 || typeof parameters.prompt !== 'string' || !parameters.prompt.trim()
    || parameters.prompt.length > 4000 || Object.values(references).some(ids => ids.length)) {
    throw new AiChannelError('Для этого канала подтверждён только текст → одно фото. Дополнительные настройки и референсы не поддерживаются.', 400);
  }
  return { catalogId: `channel:${modelId}`, endpoint: upstreamId, parameters: { prompt: parameters.prompt }, references: {} };
}
export async function channelPhotoCatalog() {
  const rows = await db.select({ model: meduhaAiModels, channel: meduhaAiChannels }).from(meduhaAiModels)
    .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId)).where(eq(meduhaAiModels.kind, 'photo'));
  return rows.filter(row => ['apinet', 'openai-compatible'].includes(row.channel.adapter)).map(({ model, channel }) => {
    const issues: string[] = [];
    if (!channelPhotoProtocol(model.providerSchema) || model.providerSchema.binding !== channelBinding(channel, model.upstreamId)) issues.push('Нет подтверждённого протокола для этого канала');
    if (!model.enabled) issues.push('Модель отключена');
    if (!channel.enabled) issues.push('Канал отключён');
    if (model.creditPrice <= 0) issues.push('Цена не настроена');
    if (!channelConfigured(channel)) issues.push('Ключ или адрес канала не настроен');
    return {
      id: `channel:${model.id}`, endpoint: model.upstreamId, name: model.displayName, source: model.providerSchemaUrl ?? '',
      schema: channelImageSchema, workflow: false, modelId: model.id, creditPrice: model.creditPrice > 0 ? model.creditPrice : null,
      available: !issues.length, availabilityIssues: issues, pricingBlockedReason: null,
    };
  });
}
