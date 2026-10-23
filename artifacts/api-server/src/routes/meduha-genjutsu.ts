import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, meduhaAiChannels, meduhaAiModels, pool } from '@workspace/db';
import { CreateGenjutsuGenerationBody, CreateGenjutsuPriceQuoteBody } from '@workspace/api-zod';
import type { GenjutsuInput, GenjutsuPriceQuoteInput } from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { publicJob } from './meduha-generations';
import { FinanceError, getFinanceSettings, reserveCredits } from '../lib/finance';
import {
  GENJUTSU_ENDPOINTS, GenjutsuError, getGenjutsuStyles, prepareGenjutsuMedia,
  configuredGenjutsuPrice, genjutsuPricingFingerprint, quoteMatchesRequest, signGenjutsuQuote,
  validateGenjutsuReferences, verifyGenjutsuQuote, type GenjutsuMetadata, type GenjutsuQuoteClaims,
} from '../lib/genjutsu';

export type GenjutsuDependencies = {
  prepareMedia?: typeof prepareGenjutsuMedia;
  styles?: typeof getGenjutsuStyles;
};
const fail = (res: Response, status: number, code: string, error: string) => res.status(status).json({ code, error });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type StoredInput = {
  prompt: string; resolution: string; duration: number; aspect_ratio: string; _genjutsu: GenjutsuMetadata;
  _genjutsuPricingQuote?: Pick<GenjutsuQuoteClaims, 'scenario' | 'resolution' | 'duration' | 'creditPrice' | 'pricingFingerprint'>;
};
const fields = {
  id: meduhaAiModels.id, name: meduhaAiModels.displayName, upstreamId: meduhaAiModels.upstreamId,
  creditPrice: meduhaAiModels.creditPrice, limits: meduhaAiModels.limits,
  genjutsuPricing: meduhaAiModels.genjutsuPricing,
  channelId: meduhaAiModels.channelId, enabled: meduhaAiModels.enabled,
  channelEnabled: meduhaAiChannels.enabled, adapter: meduhaAiChannels.adapter,
};
function matchesRequest(job: Record<string, any>, body: GenjutsuInput) {
  const input = job.input as StoredInput;
  const metadata = input?._genjutsu;
  return job.model_id === body.modelId && metadata?.scenario === body.scenario
    && metadata.endpoint === GENJUTSU_ENDPOINTS[body.scenario]
    && metadata.videoId === body.videoId
    && JSON.stringify(metadata.imageIds) === JSON.stringify(body.imageIds)
    && (metadata.presetId ?? '') === (body.presetId ?? '')
    && input.prompt === body.prompt.trim() && input.resolution === body.resolution;
}
async function sendJob(res: Response, id: string) {
  const { rows } = await pool.query(
    `SELECT j.*, m.display_name FROM meduha_generation_jobs j
     JOIN meduha_ai_models m ON m.id = j.model_id WHERE j.id = $1`, [id],
  );
  res.status(202).json({ job: publicJob(rows[0]) });
}

export function createGenjutsuRouter(dependencies: GenjutsuDependencies = {}) {
  const router = Router();
  const styles = dependencies.styles ?? getGenjutsuStyles;
  router.get('/genjutsu/models', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram.'); return; }
    const [models, settings] = await Promise.all([
      db.select(fields).from(meduhaAiModels)
        .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
        .where(and(
          eq(meduhaAiModels.enabled, true), eq(meduhaAiChannels.enabled, true),
          eq(meduhaAiChannels.adapter, 'higgsfield'), inArray(meduhaAiModels.upstreamId, Object.values(GENJUTSU_ENDPOINTS)),
        )),
      getFinanceSettings(),
    ]);
    res.json({
      spendingEnabled: settings.spendingEnabled,
      models: models.filter(model => (Number.isSafeInteger(model.creditPrice) && model.creditPrice > 0)
        || model.genjutsuPricing.length > 0).map(model => ({
        id: model.id, name: model.name, upstreamId: model.upstreamId, creditPrice: model.creditPrice, limits: model.limits,
      })),
    });
  });
  router.post('/genjutsu/quote', async (req, res): Promise<void> => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы проверить цену.'); return; }
    const parsed = CreateGenjutsuPriceQuoteBody.safeParse(req.body);
    if (!parsed.success) { fail(res, 400, 'INVALID_INPUT', 'Проверь сценарий, видео, модель и качество.'); return; }
    const body: GenjutsuPriceQuoteInput = parsed.data;
    try {
      const [model] = await db.select(fields).from(meduhaAiModels)
        .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
        .where(eq(meduhaAiModels.id, body.modelId)).limit(1);
      if (!model || !model.enabled || !model.channelEnabled || model.adapter !== 'higgsfield'
        || model.upstreamId !== GENJUTSU_ENDPOINTS[body.scenario]) {
        fail(res, 409, 'MODEL_UNAVAILABLE', 'Этот сценарий сейчас недоступен. Обнови список моделей.'); return;
      }
      const metadata: GenjutsuMetadata = {
        scenario: body.scenario, endpoint: GENJUTSU_ENDPOINTS[body.scenario],
        videoId: body.videoId, imageIds: [],
      };
      const video = await (dependencies.prepareMedia ?? prepareGenjutsuMedia)(account.id, metadata);
      const minDuration = Number(model.limits?.minDuration ?? 4);
      const maxDuration = Number(model.limits?.maxDuration ?? 30);
      if (video.duration < minDuration || video.duration > maxDuration) {
        throw new GenjutsuError(`Для этой модели допустимо от ${minDuration} до ${maxDuration} секунд после обрезки.`);
      }
      const creditPrice = configuredGenjutsuPrice(model.creditPrice, model.genjutsuPricing, {
        scenario: body.scenario, resolution: body.resolution, duration: video.duration,
      });
      if (creditPrice === null) {
        fail(res, 409, 'MODEL_NOT_PRICED', 'Для этого качества и длительности администратор ещё не настроил цену.'); return;
      }
      const expiresAt = Date.now() + 3 * 60 * 1000;
      const claims: GenjutsuQuoteClaims = {
        version: 1, accountId: account.id, modelId: model.id, scenario: body.scenario,
        videoId: body.videoId, resolution: body.resolution, duration: video.duration,
        creditPrice, pricingFingerprint: genjutsuPricingFingerprint(model.creditPrice, model.genjutsuPricing), expiresAt,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json({ quoteToken: signGenjutsuQuote(claims), creditPrice, duration: video.duration, expiresAt });
    } catch (error) {
      if (error instanceof GenjutsuError) fail(res, error.status, 'GENJUTSU_INPUT', error.message);
      else fail(res, 503, 'GENJUTSU_UNAVAILABLE', 'Не удалось проверить цену. Повтори немного позже.');
    }
  });
  router.get('/genjutsu/styles', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram.'); return; }
    const modelId = req.query.modelId;
    if (typeof modelId !== 'string' || !uuid.test(modelId)) { fail(res, 400, 'INVALID_INPUT', 'Выбери модель.'); return; }
    const [model] = await db.select(fields).from(meduhaAiModels)
      .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
      .where(eq(meduhaAiModels.id, modelId)).limit(1);
    if (!model || !model.enabled || !model.channelEnabled || model.adapter !== 'higgsfield'
      || model.upstreamId !== GENJUTSU_ENDPOINTS.restyle
      || (model.creditPrice <= 0 && model.genjutsuPricing.length === 0)) {
      fail(res, 409, 'MODEL_UNAVAILABLE', 'Модель смены стиля сейчас недоступна.'); return;
    }
    try { res.json({ items: await styles() }); }
    catch { fail(res, 503, 'STYLES_UNAVAILABLE', 'Не удалось загрузить стили. Повтори позже.'); }
  });
  router.post('/genjutsu/generations', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы запускать генерацию.'); return; }
    const parsed = CreateGenjutsuGenerationBody.safeParse(req.body);
    if (!parsed.success) { fail(res, 400, 'INVALID_INPUT', 'Проверь файлы, сценарий и параметры генерации.'); return; }
    const body = parsed.data;
    try {
      validateGenjutsuReferences(body.scenario, body.imageIds, body.presetId);
      const prior = await pool.query(
        `SELECT * FROM meduha_generation_jobs WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [account.id, body.idempotencyKey],
      );
      let job = prior.rows[0] as Record<string, any> | undefined;
      if (job && !matchesRequest(job, body)) {
        fail(res, 409, 'IDEMPOTENCY_CONFLICT', 'Этот запрос уже использован с другими параметрами.'); return;
      }
      if (job && job.status !== 'awaiting_reservation') { await sendJob(res, job.id); return; }
      if (!job) {
        const [model] = await db.select(fields).from(meduhaAiModels)
          .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
          .where(eq(meduhaAiModels.id, body.modelId)).limit(1);
        if (!model || !model.enabled || !model.channelEnabled || model.adapter !== 'higgsfield'
          || model.upstreamId !== GENJUTSU_ENDPOINTS[body.scenario]) {
          fail(res, 409, 'MODEL_UNAVAILABLE', 'Этот сценарий сейчас недоступен. Обнови список моделей.'); return;
        }
        if (!body.quoteToken) {
          fail(res, 409, 'PRICE_QUOTE_REQUIRED', 'Сначала запроси точную цену для этих параметров.'); return;
        }
        if ((!Number.isSafeInteger(model.creditPrice) || model.creditPrice <= 0) && model.genjutsuPricing.length === 0) {
          fail(res, 409, 'MODEL_NOT_PRICED', 'Администратор ещё не настроил стоимость.'); return;
        }
        if (!(await getFinanceSettings()).spendingEnabled) {
          fail(res, 409, 'SPENDING_DISABLED', 'Запуск генераций временно отключён.'); return;
        }
        const metadata: GenjutsuMetadata = {
          scenario: body.scenario, endpoint: GENJUTSU_ENDPOINTS[body.scenario],
          videoId: body.videoId, imageIds: body.imageIds, ...(body.presetId ? { presetId: body.presetId } : {}),
        };
        const video = await (dependencies.prepareMedia ?? prepareGenjutsuMedia)(account.id, metadata);
        const minDuration = Number(model.limits?.minDuration ?? 4);
        const maxDuration = Number(model.limits?.maxDuration ?? 30);
        if (video.duration < minDuration || video.duration > maxDuration) {
          throw new GenjutsuError(`Для этой модели допустимо от ${minDuration} до ${maxDuration} секунд после обрезки.`);
        }
        if (body.scenario === 'restyle' && !(await styles()).some(item => item.id === body.presetId)) {
          throw new GenjutsuError('Этот стиль больше недоступен. Обнови список стилей и выбери другой.');
        }
        const claims = verifyGenjutsuQuote(body.quoteToken);
        if (!quoteMatchesRequest(claims, {
          accountId: account.id, modelId: model.id, scenario: body.scenario, videoId: body.videoId,
          resolution: body.resolution, duration: video.duration,
        })) {
          throw new GenjutsuError('Котировка относится к другим параметрам видео. Запроси цену заново.', 409);
        }
        const currentPrice = configuredGenjutsuPrice(model.creditPrice, model.genjutsuPricing, {
          scenario: body.scenario, resolution: body.resolution, duration: video.duration,
        });
        if (currentPrice !== claims.creditPrice
          || genjutsuPricingFingerprint(model.creditPrice, model.genjutsuPricing) !== claims.pricingFingerprint) {
          throw new GenjutsuError('Цена изменилась. Запроси новую котировку.', 409);
        }
        const input: StoredInput = {
          prompt: body.prompt.trim(), resolution: body.resolution,
          duration: video.duration, aspect_ratio: 'source', _genjutsu: metadata,
          _genjutsuPricingQuote: {
            scenario: claims.scenario, resolution: claims.resolution, duration: claims.duration,
            creditPrice: claims.creditPrice, pricingFingerprint: claims.pricingFingerprint,
          },
        };
        const inserted = await pool.query(
          `INSERT INTO meduha_generation_jobs
           (id, account_id, model_id, channel_id, credit_price, idempotency_key, status, input)
           VALUES ($1,$2,$3,$4,$5,$6,'awaiting_reservation',$7::jsonb)
           ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING *`,
          [randomUUID(), account.id, model.id, model.channelId, claims.creditPrice, body.idempotencyKey, JSON.stringify(input)],
        );
        if (inserted.rows[0]) job = inserted.rows[0];
        else {
          const existing = await pool.query(
            `SELECT * FROM meduha_generation_jobs WHERE account_id = $1 AND idempotency_key = $2`,
            [account.id, body.idempotencyKey],
          );
          job = existing.rows[0];
          if (!job || !matchesRequest(job, body)) {
            fail(res, 409, 'IDEMPOTENCY_CONFLICT', 'Этот запрос уже использован с другими параметрами.'); return;
          }
        }
      }
      if (!job) throw new Error('Generation job missing');
      if (job.status === 'awaiting_reservation') {
        try {
          const held = await reserveCredits({
            accountId: account.id, actorId: account.id, amount: Number(job.credit_price),
            reason: `Genjutsu · ${body.scenario} · ${job.input.duration}s · ${body.resolution}`,
            modelId: job.model_id, idempotencyKey: `generation-reserve:${account.id}:${body.idempotencyKey}`,
            ...(job.input._genjutsuPricingQuote ? { genjutsuQuote: job.input._genjutsuPricingQuote } : {}),
          });
          if (!held.reservation) throw new Error('Reservation missing');
          await pool.query(
            `UPDATE meduha_generation_jobs SET reservation_id = $2, status = 'queued', updated_at = now()
             WHERE id = $1 AND status = 'awaiting_reservation'`, [job.id, held.reservation.id],
          );
        } catch (error) {
          if (error instanceof FinanceError) {
            await pool.query(
              `UPDATE meduha_generation_jobs SET status = 'failed', error_message = $2, updated_at = now()
               WHERE id = $1 AND status = 'awaiting_reservation'`, [job.id, error.message],
            );
            fail(res, 409, error.code, error.message); return;
          }
          throw error;
        }
      }
      await sendJob(res, job.id);
    } catch (error) {
      if (error instanceof GenjutsuError) fail(res, error.status, 'GENJUTSU_INPUT', error.message);
      else fail(res, 503, 'GENJUTSU_UNAVAILABLE', 'Не удалось подтвердить запрос. Проверь историю и повтори тот же запрос, не создавая новый.');
    }
  });
  return router;
}
