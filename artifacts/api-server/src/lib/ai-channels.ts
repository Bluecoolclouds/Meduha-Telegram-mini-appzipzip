import { createHash, randomUUID } from 'node:crypto';
import { db, meduhaAiChannels, meduhaAiModels, meduhaAdminAudit } from '@workspace/db';
import { eq, sql } from 'drizzle-orm';

export type AiChannel = typeof meduhaAiChannels.$inferSelect;
export type DiscoveredModel = { id: string; endpoints: string[]; importable: boolean; reason: string | null };
export class AiChannelError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const AI_ADAPTERS = ['higgsfield', 'apinet', 'openai-compatible'] as const;

// An administrator-entered URL is not permission to send server secrets to any
// host. Additional providers require an explicitly allowed public HTTPS host.
export function channelBase(channel: Pick<AiChannel, 'adapter' | 'baseUrl'>) {
  if (!['apinet', 'openai-compatible'].includes(channel.adapter)) throw new AiChannelError('Этот адаптер не поддерживает протокол OpenAI Images.');
  let url: URL;
  try { url = new URL(channel.baseUrl); } catch { throw new AiChannelError('Некорректный адрес API.'); }
  const hosts = ['apinet.cloud', ...(process.env.MEDUHA_AI_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim()).filter(Boolean)];
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || !hosts.includes(url.hostname)
    || !['/', '/v1', '/v1/'].includes(url.pathname)
    || (channel.adapter === 'apinet' && url.hostname !== 'apinet.cloud')) {
    throw new AiChannelError('Разрешён только доверенный HTTPS API. Для другого сервиса добавь его хост в MEDUHA_AI_ALLOWED_HOSTS.');
  }
  return `${url.origin}/v1`;
}
export function channelCredential(channel: Pick<AiChannel, 'secretRef'>) {
  const name = channel.secretRef?.replace(/^secret:\/\//, '') ?? '';
  if (!/^(apinet_key|AI_PROVIDER_[A-Z0-9_]{1,80})$/.test(name)) {
    throw new AiChannelError('Укажи ссылку secret://apinet_key или secret://AI_PROVIDER_ИМЯ. Значение ключа вводится только в Secrets.');
  }
  const value = process.env[name];
  if (!value || !/^\S+$/.test(value)) throw new AiChannelError('Секрет канала не настроен.', 503);
  return value;
}
export function channelConfigured(channel: AiChannel) {
  try { channelBase(channel); channelCredential(channel); return true; } catch { return false; }
}
export function channelBinding(channel: Pick<AiChannel, 'id' | 'adapter' | 'baseUrl' | 'secretRef'>, upstreamId: string) {
  return createHash('sha256').update(JSON.stringify([channel.id, channel.adapter, channel.baseUrl, channel.secretRef, upstreamId])).digest('hex');
}
export async function discoverChannel(channel: AiChannel, fetcher: typeof fetch = fetch): Promise<DiscoveredModel[]> {
  const response = await fetcher(`${channelBase(channel)}/models`, {
    headers: { Authorization: `Bearer ${channelCredential(channel)}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiChannelError(`Каталог провайдера вернул HTTP ${response.status}. Это не проверка генерации.`, 502);
  }
  const text = await readBoundedResponse(response, 4 * 1024 * 1024);
  let body: { data?: unknown };
  try { body = JSON.parse(text); } catch { throw new AiChannelError('Провайдер вернул не JSON.', 502); }
  if (!Array.isArray(body?.data) || body.data.length > 10000) throw new AiChannelError('Некорректный каталог провайдера.', 502);
  const seen = new Set<string>();
  return body.data.flatMap(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(row.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    const endpoints = Array.isArray(row.supported_endpoint_types) ? row.supported_endpoint_types.filter((x: unknown): x is string => typeof x === 'string' && x.length < 80).slice(0, 20) : [];
    const importable = endpoints.includes('image-generation');
    return [{ id: row.id, endpoints, importable, reason: importable ? null : 'Каталог не подтверждает протокол Image Generation. По имени модели поддержка не определяется.' }];
  });
}
export async function readBoundedResponse(response: Response, maximum: number) {
  if (!response.body) throw new AiChannelError('Пустой ответ провайдера.', 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new AiChannelError('Слишком большой ответ провайдера.', 502);
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString('utf8');
}
export const channelImageSchema = {
  type: 'object', additionalProperties: false, required: ['prompt'],
  properties: { prompt: { type: 'string', title: 'Описание', minLength: 1, maxLength: 4000 } },
};
export async function registerApinetChannel() {
  const rows = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.adapter, 'apinet')).limit(1);
  if (rows.length) return;
  await db.insert(meduhaAiChannels).values({
    id: '8f581ae9-0fb1-4b4c-b31a-340be95e4b80', name: 'APINet', adapter: 'apinet',
    baseUrl: 'https://apinet.cloud/v1', secretRef: 'secret://apinet_key', enabled: false,
    dailyCreditLimit: 0, concurrencyLimit: 1,
  }).onConflictDoNothing();
}
export async function importChannelModels(channel: AiChannel, ids: string[], actorId?: string) {
  // Import uses a fresh authenticated catalogue, never a browser-supplied
  // capability claim. It does not enable the channel or assign a tariff.
  const discovered = await discoverChannel(channel);
  const entries = ids.map(id => discovered.find(row => row.id === id));
  if (entries.some(row => !row?.importable)) throw new AiChannelError('Выбрана модель без подтверждённого протокола Image Generation.');
  return db.transaction(async tx => {
  await tx.execute(sql`SELECT id FROM meduha_ai_channels WHERE id=${channel.id} FOR UPDATE`);
  const [current] = await tx.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.id, channel.id));
  if (!current || channelBinding(current, '') !== channelBinding(channel, '')) throw new AiChannelError('Настройки канала изменились. Повтори проверку.');
  const existing = await tx.select().from(meduhaAiModels).where(eq(meduhaAiModels.channelId, channel.id));
  let imported = 0;
  for (const entry of entries as DiscoveredModel[]) {
    const providerSchema = {
      schemaAvailable: true,
      parameters: [{ name: 'prompt', type: 'string', required: true, minLength: 1, maxLength: 4000, description: 'Текст → одно фото. Другие параметры не подтверждены.' }],
      protocol: 'openai-images-v1', binding: channelBinding(channel, entry.id),
      verification: 'catalog-only', checkedAt: new Date().toISOString(), advertisedEndpoints: entry.endpoints,
    };
    const prior = existing.find(row => row.upstreamId === entry.id);
    if (prior) {
      await tx.update(meduhaAiModels).set({ providerSchema, providerSchemaUrl: 'https://platform.openai.com/docs/api-reference/images/create', updatedAt: new Date() })
        .where(eq(meduhaAiModels.id, prior.id));
    } else await tx.insert(meduhaAiModels).values({
      id: randomUUID(), channelId: channel.id, upstreamId: entry.id, displayName: `${channel.name} · ${entry.id}`,
      kind: 'photo', enabled: false, creditPrice: 0, estimatedCost: null, limits: {},
      providerSchemaUrl: 'https://platform.openai.com/docs/api-reference/images/create', providerSchema,
    });
    imported++;
  }
  if (actorId) await tx.insert(meduhaAdminAudit).values({ actorId, action: 'channel.models.import', entityType: 'channel', entityId: channel.id, details: { processed: imported } });
  return imported;
  });
}
export async function submitChannelImage(channel: AiChannel, upstreamId: string, prompt: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${channelBase(channel)}/images/generations`, {
    method: 'POST', headers: { Authorization: `Bearer ${channelCredential(channel)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model: upstreamId, prompt, n: 1 }),
    redirect: 'error', signal: AbortSignal.timeout(90_000),
  });
  // A billable POST is never retried or silently sent to another channel.
  if (!response.ok) { await response.body?.cancel(); throw new AiChannelError(`Генерация вернула HTTP ${response.status}; исход требует проверки.`, 502); }
  const body = JSON.parse(await readBoundedResponse(response, 36 * 1024 * 1024)) as { data?: { url?: string; b64_json?: string }[] };
  if (!Array.isArray(body.data) || body.data.length !== 1 || !(body.data[0].url || body.data[0].b64_json)) throw new AiChannelError('Провайдер не вернул одно изображение.', 502);
  return body.data;
}
