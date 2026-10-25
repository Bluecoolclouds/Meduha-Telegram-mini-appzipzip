import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, meduhaAiChannels, meduhaAiModels, pool } from '@workspace/db';
import { CreatePhotoGenerationBody, QuotePhotoGenerationBody } from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { publicJob } from './meduha-generations';
import { FinanceError, getFinanceSettings, reserveCredits } from '../lib/finance';
import { higgsfieldCredentials } from '../lib/higgsfield';
import { generationImageFile } from '../lib/photo-storage';
import { photoModels, PhotoInputError, photoProviderInput, stablePhotoInput, validatePhotoInput, verifyPhotoReferences, type PhotoMetadata } from '../lib/photo';
import { assertPhotoQuote, estimatePhotoRequest, photoPricingBlockedReason, photoPricingFingerprint, photoQuotedPrice, photoQuoteSummary, photoRequestHash, PhotoPricingError, signPhotoQuote, verifyPhotoQuote } from '../lib/photo-pricing';

const fail = (res: Response, code: string, message: string, status = 409) => res.status(status).json({ code, error: message });
export function photoProviderConfigured() {
  try { higgsfieldCredentials(); return true; } catch { return false; }
}

// A documented catalogue entry is not permission to spend. Never modify prices,
// existing channel settings or enable flags during registration.
export async function registerPhotoModels() {
  const defaultChannelId = 'c421c9b0-25d5-45f6-91f5-c8938dcfdb85';
  let [channel] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.adapter, 'higgsfield')).limit(1);
  if (!channel) {
    await db.insert(meduhaAiChannels).values({
      id: defaultChannelId, name: 'Higgsfield', adapter: 'higgsfield',
      baseUrl: 'https://api.higgsfield.ai', secretRef: 'secret://higgs_api', enabled: false,
    }).onConflictDoNothing();
    [channel] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.id, defaultChannelId));
  }
  // Normalize the old auto-created reference, not the credential itself.
  // The administrator API requires the public secret:// reference syntax.
  if (channel.id === defaultChannelId && channel.secretRef === 'higgs_api') {
    await db.update(meduhaAiChannels).set({ secretRef: 'secret://higgs_api' }).where(eq(meduhaAiChannels.id, channel.id));
  }
  for (const model of photoModels.filter((m, i, all) => all.findIndex(x => x.endpoint === m.endpoint) === i)) {
    const [existing] = await db.select({ id: meduhaAiModels.id }).from(meduhaAiModels)
      .where(and(eq(meduhaAiModels.channelId, channel.id), eq(meduhaAiModels.upstreamId, model.endpoint))).limit(1);
    if (!existing) await db.insert(meduhaAiModels).values({
      id: randomUUID(), channelId: channel.id, upstreamId: model.endpoint,
      displayName: model.name, kind: 'photo', enabled: false, creditPrice: 0,
      providerSchemaUrl: model.source,
    }).onConflictDoNothing();
  }
}

export function createPhotoRouter(dependencies: {
  verifyReferences?: typeof verifyPhotoReferences;
  providerConfigured?: () => boolean;
  storageConfigured?: () => boolean;
  estimate?: typeof estimatePhotoRequest;
  providerInput?: (accountId: string, metadata: PhotoMetadata) => Promise<Record<string, unknown>>;
} = {}) {
  const router = Router();
  const providerReady = dependencies.providerConfigured ?? photoProviderConfigured;
  const storageReady = dependencies.storageConfigured ?? (() => !!process.env.PRIVATE_OBJECT_DIR);
  const checkReferences = dependencies.verifyReferences ?? verifyPhotoReferences;
  const estimate = dependencies.estimate ?? estimatePhotoRequest;
  const providerInput = dependencies.providerInput ?? photoProviderInput;
  const configuredModel = async (modelId: string, endpoint: string) => {
    const [model] = await db.select({
      id: meduhaAiModels.id, channelId: meduhaAiModels.channelId, upstreamId: meduhaAiModels.upstreamId,
      price: meduhaAiModels.creditPrice, enabled: meduhaAiModels.enabled, channelEnabled: meduhaAiChannels.enabled,
      kind: meduhaAiModels.kind, adapter: meduhaAiChannels.adapter,
    }).from(meduhaAiModels).innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
      .where(eq(meduhaAiModels.id, modelId)).limit(1);
    if (!model || model.kind !== 'photo' || model.adapter !== 'higgsfield' || model.upstreamId !== endpoint || !model.enabled || !model.channelEnabled) {
      throw new PhotoPricingError('MODEL_UNAVAILABLE', 'Эта модель отключена администратором.');
    }
    return model;
  };
  router.get('/photo/catalog', async (_req, res) => {
    const [settings, rows] = await Promise.all([
      getFinanceSettings(),
      db.select({
        id: meduhaAiModels.id, upstreamId: meduhaAiModels.upstreamId,
        price: meduhaAiModels.creditPrice, enabled: meduhaAiModels.enabled, channelEnabled: meduhaAiChannels.enabled,
      }).from(meduhaAiModels).innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
        .where(and(eq(meduhaAiModels.kind, 'photo'), eq(meduhaAiChannels.adapter, 'higgsfield'))),
    ]);
    res.json({
      spendingEnabled: settings.spendingEnabled, providerConfigured: providerReady(),
      storageConfigured: storageReady(),
      models: photoModels.map(model => {
        const candidates = rows.filter(row => row.upstreamId === model.endpoint);
        const configured = candidates.find(row => row.enabled && row.channelEnabled && row.price > 0) ?? candidates[0];
        return {
          ...model, available: !photoPricingBlockedReason(model.endpoint) && !!configured?.enabled && !!configured.channelEnabled && configured.price > 0,
          pricingBlockedReason: photoPricingBlockedReason(model.endpoint),
          modelId: configured?.id ?? null, creditPrice: configured && configured.price > 0 ? configured.price : null,
        };
      }),
    });
  });

  router.post('/photo/quote', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы рассчитать цену.', 401); return; }
    const parsed = QuotePhotoGenerationBody.safeParse(req.body);
    if (!parsed.success) { fail(res, 'INVALID_INPUT', 'Проверь модель и настройки.', 400); return; }
    const body = parsed.data;
    const entry = photoModels.find(model => model.id === body.catalogId);
    if (!entry) { fail(res, 'MODEL_UNAVAILABLE', 'Фотомодель не найдена.'); return; }
    const metadata: PhotoMetadata = { catalogId: entry.id, endpoint: entry.endpoint, parameters: body.parameters, references: body.references };
    try {
      validatePhotoInput(metadata);
      const blocked = photoPricingBlockedReason(entry.endpoint);
      if (blocked) throw new PhotoPricingError('UNSAFE_PHOTO_PRICE', blocked);
      const model = await configuredModel(body.modelId, entry.endpoint);
      if (!providerReady() || !storageReady()) throw new PhotoPricingError('PROVIDER_NOT_CONFIGURED', 'Провайдер или хранилище ещё не настроены.');
      if (!(await getFinanceSettings()).spendingEnabled) throw new PhotoPricingError('SPENDING_DISABLED', 'Запуск генераций временно отключён.');
      await checkReferences(account.id, metadata);
      const usdMicros = await estimate(entry.endpoint, await providerInput(account.id, metadata));
      const creditPrice = photoQuotedPrice(model.price, metadata, usdMicros);
      const expiresAt = Date.now() + 5 * 60_000;
      const token = signPhotoQuote({
        purpose: 'photo-price', accountId: account.id, modelId: model.id, idempotencyKey: body.idempotencyKey,
        requestHash: photoRequestHash(metadata), pricingFingerprint: photoPricingFingerprint(model.price),
        creditPrice, expiresAt, usdMicros,
      });
      res.set('Cache-Control', 'no-store').json({ token, creditPrice, expiresAt, ...photoQuoteSummary(metadata) });
    } catch (error) {
      if (error instanceof PhotoInputError) fail(res, 'INVALID_INPUT', error.message, 400);
      else if (error instanceof PhotoPricingError) fail(res, error.code, error.message, error.status);
      else {
        req.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Photo estimate failed');
        fail(res, 'QUOTE_UNAVAILABLE', 'Не удалось получить смету. Генерация не запущена.', 503);
      }
    }
  });

  router.get('/generations/:id/images/:index', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 'SESSION_REQUIRED', 'Войди через Telegram.', 401); return; }
    const index = Number(req.params.index);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !/^[0-7]$/.test(req.params.index)) { res.sendStatus(404); return; }
    const { rows } = await pool.query(
      `SELECT status, input, result_url FROM meduha_generation_jobs WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [req.params.id, account.id],
    );
    const job = rows[0];
    if (!job?.input?._photo || job.status !== 'completed') { res.sendStatus(404); return; }
    const urls = parsePhotoResultUrls(job.result_url);
    const expected = `/api/meduha/generations/${req.params.id}/images/${index}`;
    if (urls[index] !== expected) { res.sendStatus(404); return; }
    const file = generationImageFile(req.params.id, index);
    try {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(metadata.contentType ?? '') || !Number.isSafeInteger(size) || size < 12 || size > 25 * 1024 * 1024) throw new Error('Invalid image');
      res.set({
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Type': metadata.contentType!, 'Content-Length': String(size),
        'Content-Disposition': req.query.download === '1' ? `attachment; filename="meduha-${req.params.id}-${index + 1}.${metadata.contentType === 'image/jpeg' ? 'jpg' : metadata.contentType!.split('/')[1]}"` : 'inline',
      });
      const stream = file.createReadStream();
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if ((error as { code?: number }).code === 404) res.sendStatus(404);
      else fail(res, 'IMAGE_UNAVAILABLE', 'Не удалось загрузить изображение. Попробуй позже.', 503);
    }
  });

  router.post('/photo/generations', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы создать фото.', 401); return; }
    const parsed = CreatePhotoGenerationBody.safeParse(req.body);
    if (!parsed.success) { fail(res, 'INVALID_INPUT', 'Проверь модель и настройки.', 400); return; }
    const body = parsed.data;
    const entry = photoModels.find(model => model.id === body.catalogId);
    if (!entry) { fail(res, 'MODEL_UNAVAILABLE', 'Фотомодель не найдена.'); return; }
    const metadata: PhotoMetadata = { catalogId: entry.id, endpoint: entry.endpoint, parameters: body.parameters, references: body.references };
    try {
      validatePhotoInput(metadata);
      const prior = await pool.query(
        `SELECT * FROM meduha_generation_jobs WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [account.id, body.idempotencyKey],
      );
      let job = prior.rows[0] as Record<string, any> | undefined;
      const matches = (row: Record<string, any>) => row.model_id === body.modelId
        && Number(row.credit_price) === body.expectedCreditPrice
        && row.input._photoQuote === body.priceQuote
        && stablePhotoInput(row.input._photo) === stablePhotoInput(metadata);
      if (job && !matches(job)) { fail(res, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для других параметров.'); return; }
      const sendJob = async () => {
        const result = await pool.query(`SELECT j.*, m.display_name FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id = j.model_id WHERE j.id = $1`, [job!.id]);
        res.status(202).json({ job: publicJob(result.rows[0]) });
      };
      if (job && job.status !== 'awaiting_reservation') { await sendJob(); return; }
      const claims = verifyPhotoQuote(body.priceQuote);
      assertPhotoQuote(claims, account.id, body.modelId, body.idempotencyKey, metadata, body.expectedCreditPrice);
      const blocked = photoPricingBlockedReason(entry.endpoint);
      if (blocked) throw new PhotoPricingError('UNSAFE_PHOTO_PRICE', blocked);
      if (!job) {
        if (!providerReady() || !storageReady()) { fail(res, 'PROVIDER_NOT_CONFIGURED', 'Провайдер или хранилище ещё не настроены.'); return; }
        const model = await configuredModel(body.modelId, entry.endpoint);
        const price = photoQuotedPrice(model.price, metadata, claims.usdMicros);
        if (price !== body.expectedCreditPrice || claims.pricingFingerprint !== photoPricingFingerprint(model.price)) {
          throw new PhotoPricingError('STALE_PRICE_QUOTE', 'Цена изменилась. Рассчитай и подтверди новую стоимость.');
        }
        if (!(await getFinanceSettings()).spendingEnabled) { fail(res, 'SPENDING_DISABLED', 'Запуск генераций временно отключён.'); return; }
        await checkReferences(account.id, metadata);
        const input = {
          prompt: String(body.parameters.prompt ?? body.parameters.brief ?? ''),
          duration: 0, resolution: String(body.parameters.resolution ?? ''),
          aspect_ratio: String(body.parameters.aspect_ratio ?? '1:1'), _photo: metadata, _photoQuote: body.priceQuote,
        };
        await pool.query(
          `INSERT INTO meduha_generation_jobs (id, account_id, model_id, channel_id, credit_price, idempotency_key, status, input)
           VALUES ($1,$2,$3,$4,$5,$6,'awaiting_reservation',$7::jsonb)
           ON CONFLICT (account_id,idempotency_key) DO NOTHING`,
          [randomUUID(), account.id, model.id, model.channelId, price, body.idempotencyKey, JSON.stringify(input)],
        );
        const saved = await pool.query(`SELECT * FROM meduha_generation_jobs WHERE account_id=$1 AND idempotency_key=$2`, [account.id, body.idempotencyKey]);
        job = saved.rows[0];
        if (!job || !matches(job)) { fail(res, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для других параметров.'); return; }
      }
      if (job.status === 'awaiting_reservation') {
        const held = await reserveCredits({
          accountId: account.id, actorId: account.id, amount: Number(job.credit_price),
          modelId: body.modelId, reason: `${entry.name} · фото`,
          photoQuote: { token: body.priceQuote, metadata, requestKey: body.idempotencyKey },
          idempotencyKey: `generation-reserve:${account.id}:${body.idempotencyKey}`,
        });
        if (!held.reservation) throw new Error('No reservation');
        await pool.query(`UPDATE meduha_generation_jobs SET reservation_id=$2, status='queued',updated_at=now() WHERE id=$1 AND status='awaiting_reservation'`, [job.id, held.reservation.id]);
      }
      await sendJob();
    } catch (error) {
      if (error instanceof PhotoInputError) fail(res, 'INVALID_INPUT', error.message, 400);
      else if (error instanceof PhotoPricingError) fail(res, error.code, error.message, error.status);
      else if (error instanceof FinanceError) {
        await pool.query(`UPDATE meduha_generation_jobs SET status='failed',error_message=$3,updated_at=now() WHERE account_id=$1 AND idempotency_key=$2 AND status='awaiting_reservation'`, [account.id, body.idempotencyKey, error.message]);
        fail(res, error.code, error.message);
      } else {
        req.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Photo request failed');
        fail(res, 'PHOTO_TEMPORARILY_UNAVAILABLE', 'Не удалось подтвердить запрос. Повтори с теми же параметрами.', 503);
      }
    }
  });
  return router;
}

export function parsePhotoResultUrls(value: unknown): string[] {
  try {
    const urls = typeof value === 'string' ? JSON.parse(value) : [];
    return Array.isArray(urls) && urls.every(url => typeof url === 'string') ? urls : [];
  } catch { return []; }
}
