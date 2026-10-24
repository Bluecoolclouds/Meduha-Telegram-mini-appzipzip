import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, meduhaAiChannels, meduhaAiModels, pool } from '@workspace/db';
import { CreateVideoGenerationBody } from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { publicJob } from './meduha-generations';
import { FinanceError, getFinanceSettings, reserveCredits } from '../lib/finance';
import { photoProviderConfigured } from './meduha-photo';
import { stablePhotoInput } from '../lib/photo';
import { GENJUTSU_ENDPOINTS } from '../lib/genjutsu';
import { videoFamilies, videoFileFields, videoModels, VideoInputError, validateVideoInput, verifyVideoReferences, type VideoMetadata } from '../lib/video';

const fail = (res: Response, code: string, error: string, status = 409) => res.status(status).json({ code, error });
export async function registerVideoModels() {
  const [channel] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.adapter, 'higgsfield')).limit(1);
  if (!channel) throw new Error('Register the Higgsfield channel before its video models.');
  for (const entry of videoModels.filter((m, i, all) => all.findIndex(x => x.endpoint === m.endpoint) === i)) {
    const [existing] = await db.select({ id: meduhaAiModels.id }).from(meduhaAiModels)
      .where(and(eq(meduhaAiModels.channelId, channel.id), eq(meduhaAiModels.upstreamId, entry.endpoint))).limit(1);
    if (!existing) await db.insert(meduhaAiModels).values({
      id: randomUUID(), channelId: channel.id, upstreamId: entry.endpoint, displayName: `${entry.name} · ${entry.mode}`,
      kind: 'video', enabled: false, creditPrice: 0, providerSchemaUrl: entry.source,
    }).onConflictDoNothing();
  }
}
export function createVideoRouter(dependencies: {
  verifyReferences?: typeof verifyVideoReferences; providerConfigured?: () => boolean; storageConfigured?: () => boolean;
} = {}) {
  const router = Router();
  const providerReady = dependencies.providerConfigured ?? photoProviderConfigured;
  const storageReady = dependencies.storageConfigured ?? (() => !!process.env.PRIVATE_OBJECT_DIR);
  const checkReferences = dependencies.verifyReferences ?? verifyVideoReferences;
  router.get('/video/catalog', async (_req, res) => {
    const [settings, rows] = await Promise.all([
      getFinanceSettings(),
      db.select({ id: meduhaAiModels.id, upstreamId: meduhaAiModels.upstreamId, price: meduhaAiModels.creditPrice,
        enabled: meduhaAiModels.enabled, channelEnabled: meduhaAiChannels.enabled, genjutsuPricing: meduhaAiModels.genjutsuPricing })
        .from(meduhaAiModels).innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
        .where(and(eq(meduhaAiModels.kind, 'video'), eq(meduhaAiChannels.adapter, 'higgsfield'))),
    ]);
    res.set('Cache-Control', 'no-store').json({
      families: videoFamilies, spendingEnabled: settings.spendingEnabled,
      providerConfigured: providerReady(), storageConfigured: storageReady(),
      models: videoModels.map(model => {
        const candidates = rows.filter(row => row.upstreamId === model.endpoint);
        const selected = candidates.find(r => r.enabled && r.channelEnabled && r.price > 0) ?? candidates[0];
        const nativeScenario = Object.entries(GENJUTSU_ENDPOINTS).find(([, endpoint]) => endpoint === model.endpoint)?.[0] ?? null;
        const quoteScenario = selected?.genjutsuPricing?.length && nativeScenario ? nativeScenario : null;
        return { ...model, fileFields: videoFileFields(model), modelId: selected?.id ?? null,
          quoteScenario,
          creditPrice: selected && selected.price > 0 ? selected.price : null,
          available: !quoteScenario && !!selected?.enabled && !!selected.channelEnabled && selected.price > 0 };
      }),
    });
  });
  router.post('/video/generations', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы создать видео.', 401); return; }
    const parsed = CreateVideoGenerationBody.safeParse(req.body);
    if (!parsed.success) { fail(res, 'INVALID_INPUT', 'Проверь модель и параметры видео.', 400); return; }
    const body = parsed.data;
    const entry = videoModels.find(m => m.id === body.catalogId);
    if (!entry) { fail(res, 'MODEL_UNAVAILABLE', 'Видеомодель не найдена.'); return; }
    const metadata: VideoMetadata = { catalogId: entry.id, endpoint: entry.endpoint, parameters: body.parameters, references: body.references };
    try {
      validateVideoInput(metadata);
      const prior = await pool.query('SELECT * FROM meduha_generation_jobs WHERE account_id=$1 AND idempotency_key=$2', [account.id, body.idempotencyKey]);
      let job = prior.rows[0] as Record<string, any> | undefined;
      const matches = (row: Record<string, any>) => row.model_id === body.modelId && Number(row.credit_price) === body.expectedCreditPrice
        && stablePhotoInput(row.input._video) === stablePhotoInput(metadata);
      if (job && !matches(job)) { fail(res, 'IDEMPOTENCY_CONFLICT', 'Ключ уже использован для другого запроса.'); return; }
      const sendJob = async () => {
        const saved = await pool.query('SELECT j.*,m.display_name FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id=j.model_id WHERE j.id=$1', [job!.id]);
        res.status(202).json({ job: publicJob(saved.rows[0]) });
      };
      if (job && job.status !== 'awaiting_reservation') { await sendJob(); return; }
      if (!job) {
        if (!providerReady() || !storageReady()) { fail(res, 'PROVIDER_NOT_CONFIGURED', 'Провайдер или хранилище ещё не настроены.'); return; }
        const [model] = await db.select({ id: meduhaAiModels.id, channelId: meduhaAiModels.channelId, upstreamId: meduhaAiModels.upstreamId,
          price: meduhaAiModels.creditPrice, enabled: meduhaAiModels.enabled, channelEnabled: meduhaAiChannels.enabled,
          kind: meduhaAiModels.kind, adapter: meduhaAiChannels.adapter, genjutsuPricing: meduhaAiModels.genjutsuPricing })
          .from(meduhaAiModels).innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId)).where(eq(meduhaAiModels.id, body.modelId)).limit(1);
        if (!model || model.kind !== 'video' || model.adapter !== 'higgsfield' || model.upstreamId !== entry.endpoint || !model.enabled || !model.channelEnabled) {
          fail(res, 'MODEL_UNAVAILABLE', 'Эта модель отключена администратором.'); return;
        }
        if (model.genjutsuPricing?.length && Object.values(GENJUTSU_ENDPOINTS).includes(entry.endpoint as typeof GENJUTSU_ENDPOINTS[keyof typeof GENJUTSU_ENDPOINTS])) {
          fail(res, 'QUOTE_REQUIRED', 'Для этого режима настроена цена по длительности. Используй редактор Genjutsu с проверкой видео.'); return;
        }
        if (!Number.isSafeInteger(model.price) || model.price <= 0) { fail(res, 'MODEL_NOT_PRICED', 'Для режима ещё не задана цена.'); return; }
        if (model.price !== body.expectedCreditPrice) { fail(res, 'PRICE_CHANGED', 'Цена изменилась. Обнови страницу и подтверди стоимость.'); return; }
        if (!(await getFinanceSettings()).spendingEnabled) { fail(res, 'SPENDING_DISABLED', 'Запуск генераций временно отключён.'); return; }
        await checkReferences(account.id, metadata);
        const requestedDuration = Number(body.parameters.duration ?? 0);
        const input = { prompt: String(body.parameters.prompt ?? ''), duration: Number.isFinite(requestedDuration) ? requestedDuration : 0,
          resolution: String(body.parameters.resolution ?? ''), aspect_ratio: String(body.parameters.aspect_ratio ?? ''), _video: metadata };
        await pool.query(
          `INSERT INTO meduha_generation_jobs (id,account_id,model_id,channel_id,credit_price,idempotency_key,status,input)
           VALUES ($1,$2,$3,$4,$5,$6,'awaiting_reservation',$7::jsonb) ON CONFLICT (account_id,idempotency_key) DO NOTHING`,
          [randomUUID(), account.id, model.id, model.channelId, model.price, body.idempotencyKey, JSON.stringify(input)]);
        job = (await pool.query('SELECT * FROM meduha_generation_jobs WHERE account_id=$1 AND idempotency_key=$2', [account.id, body.idempotencyKey])).rows[0];
        if (!job || !matches(job)) { fail(res, 'IDEMPOTENCY_CONFLICT', 'Ключ уже использован для другого запроса.'); return; }
      }
      if (job.status === 'awaiting_reservation') {
        const held = await reserveCredits({ accountId: account.id, actorId: account.id, amount: Number(job.credit_price),
          modelId: body.modelId, reason: `${entry.name} · ${entry.mode}`, idempotencyKey: `generation-reserve:${account.id}:${body.idempotencyKey}` });
        if (!held.reservation) throw new Error('Missing reservation');
        await pool.query(`UPDATE meduha_generation_jobs SET reservation_id=$2,status='queued',updated_at=now() WHERE id=$1 AND status='awaiting_reservation'`, [job.id, held.reservation.id]);
      }
      await sendJob();
    } catch (error) {
      if (error instanceof VideoInputError) fail(res, 'INVALID_INPUT', error.message, 400);
      else if (error instanceof FinanceError) {
        await pool.query(`UPDATE meduha_generation_jobs SET status='failed',error_message=$3,updated_at=now() WHERE account_id=$1 AND idempotency_key=$2 AND status='awaiting_reservation'`, [account.id, body.idempotencyKey, error.message]);
        fail(res, error.code, error.message);
      } else {
        req.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Video request failed');
        fail(res, 'VIDEO_TEMPORARILY_UNAVAILABLE', 'Не удалось подтвердить запрос. Повтори с теми же параметрами.', 503);
      }
    }
  });
  return router;
}
