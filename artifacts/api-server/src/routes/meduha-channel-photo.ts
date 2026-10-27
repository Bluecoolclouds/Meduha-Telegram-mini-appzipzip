import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { CreatePhotoGenerationBody, QuotePhotoGenerationBody } from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { publicJob } from './meduha-generations';
import { AiChannelError } from '../lib/ai-channels';
import { channelPhotoMetadata, channelPhotoPriceFingerprint, loadChannelPhoto } from '../lib/channel-photo';
import { FinanceError, getFinanceSettings, getModelDailyBudget, reserveCredits } from '../lib/finance';
import { assertPhotoQuote, photoRequestHash, PhotoPricingError, signPhotoQuote, verifyPhotoQuote } from '../lib/photo-pricing';
import { stablePhotoInput } from '../lib/photo';

function report(res: Response, error: unknown) {
  const known = error instanceof AiChannelError || error instanceof FinanceError || error instanceof PhotoPricingError;
  const status = error instanceof AiChannelError || error instanceof PhotoPricingError ? error.status : 409;
  res.status(known ? status : 503).json({ code: 'CHANNEL_PHOTO_UNAVAILABLE', error: known ? error.message : 'Не удалось подтвердить запрос. Повтори с теми же параметрами.' });
}
export function createChannelPhotoRouter(storageReady: () => boolean) {
  const router = Router();
  router.post('/photo/quote', async (req, res, next) => {
    if (typeof req.body?.catalogId !== 'string' || !req.body.catalogId.startsWith('channel:')) { next(); return; }
    const parsed = QuotePhotoGenerationBody.safeParse(req.body);
    const account = await currentAccount(req);
    if (!account || account.blocked) { res.status(401).json({ error: 'Войди через Telegram.' }); return; }
    if (!parsed.success) { res.status(400).json({ error: 'Некорректные параметры.' }); return; }
    try {
      const body = parsed.data;
      if (body.catalogId !== `channel:${body.modelId}`) throw new AiChannelError('Модель и канал не совпадают.', 400);
      const { model, binding } = await loadChannelPhoto(body.modelId);
      if (!storageReady() || !(await getFinanceSettings()).spendingEnabled) throw new AiChannelError('Генерации или хранилище отключены.');
      const metadata = channelPhotoMetadata(model.id, model.upstreamId, body.parameters, body.references);
      const expiresAt = Date.now() + 5 * 60_000;
      const token = signPhotoQuote({
        purpose: 'photo-price', accountId: account.id, modelId: model.id, idempotencyKey: body.idempotencyKey,
        requestHash: photoRequestHash(metadata), creditPrice: model.creditPrice, expiresAt,
        pricingFingerprint: channelPhotoPriceFingerprint(binding, model.creditPrice),
        // Internal fixed-credit quote, NOT a claimed provider cost estimate.
        usdMicros: 0,
      });
      const budget = await getModelDailyBudget(model.id);
      res.set('Cache-Control', 'no-store').json({
        token, creditPrice: model.creditPrice, expiresAt, images: 1, referenceCount: 0,
        resolution: 'стандартное провайдера', quality: 'стандартное провайдера',
        modelDailyLimit: budget.dailyCreditLimit, modelDailyRemaining: budget.dailyRemaining,
      });
    } catch (error) { report(res, error); }
  });
  router.post('/photo/generations', async (req, res, next) => {
    if (typeof req.body?.catalogId !== 'string' || !req.body.catalogId.startsWith('channel:')) { next(); return; }
    const parsed = CreatePhotoGenerationBody.safeParse(req.body);
    const account = await currentAccount(req);
    if (!account || account.blocked) { res.status(401).json({ error: 'Войди через Telegram.' }); return; }
    if (!parsed.success) { res.status(400).json({ error: 'Некорректные параметры.' }); return; }
    const body = parsed.data;
    try {
      if (body.catalogId !== `channel:${body.modelId}`) throw new AiChannelError('Модель и канал не совпадают.', 400);
      let { rows: [job] } = await pool.query('SELECT * FROM meduha_generation_jobs WHERE account_id=$1 AND idempotency_key=$2', [account.id, body.idempotencyKey]);
      const returnJob = async () => {
        const { rows: [row] } = await pool.query('SELECT j.*,m.display_name FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id=j.model_id WHERE j.id=$1', [job.id]);
        res.status(202).json({ job: publicJob(row) });
      };
      const matches = (row: Record<string, any>) => row.model_id === body.modelId
        && Number(row.credit_price) === body.expectedCreditPrice && row.input._photoQuote === body.priceQuote
        && row.input._photo?.catalogId === body.catalogId && stablePhotoInput(row.input._photo.parameters) === stablePhotoInput(body.parameters)
        && !Object.values(body.references).some(ids => ids.length);
      if (job && !matches(job)) throw new AiChannelError('Этот ключ запроса уже использован для других параметров.');
      if (job && job.status !== 'awaiting_reservation') { await returnJob(); return; }
      const { model, channel, binding } = await loadChannelPhoto(body.modelId);
      const metadata = channelPhotoMetadata(model.id, model.upstreamId, body.parameters, body.references);
      const claims = verifyPhotoQuote(body.priceQuote);
      assertPhotoQuote(claims, account.id, model.id, body.idempotencyKey, metadata, body.expectedCreditPrice);
      if (claims.pricingFingerprint !== channelPhotoPriceFingerprint(binding, model.creditPrice) || claims.creditPrice !== model.creditPrice) {
        throw new AiChannelError('Цена или канал изменились. Рассчитай цену заново.');
      }
      if (!storageReady() || !(await getFinanceSettings()).spendingEnabled) throw new AiChannelError('Генерации или хранилище отключены.');
      if (!job) {
        const input = {
          prompt: metadata.parameters.prompt, duration: 0, aspect_ratio: 'auto', resolution: 'default',
          _photo: metadata, _photoQuote: body.priceQuote, _channelPhoto: { channelId: channel.id, upstreamId: model.upstreamId, binding },
        };
        const inserted = await pool.query(`INSERT INTO meduha_generation_jobs
          (id,account_id,model_id,channel_id,idempotency_key,credit_price,status,input)
          VALUES($1,$2,$3,$4,$5,$6,'awaiting_reservation',$7) ON CONFLICT(account_id,idempotency_key) DO NOTHING RETURNING *`,
          [randomUUID(), account.id, model.id, channel.id, body.idempotencyKey, model.creditPrice, input]);
        job = inserted.rows[0] ?? (await pool.query('SELECT * FROM meduha_generation_jobs WHERE account_id=$1 AND idempotency_key=$2', [account.id, body.idempotencyKey])).rows[0];
        if (!job || !matches(job)) throw new AiChannelError('Этот ключ запроса уже использован.');
      }
      if (job.status === 'awaiting_reservation') {
        const held = await reserveCredits({
          accountId: account.id, actorId: account.id, modelId: model.id, channelId: channel.id, amount: model.creditPrice,
          reason: `${model.displayName} · одно фото`, idempotencyKey: `generation-reserve:${account.id}:${body.idempotencyKey}`,
        });
        if (!held.reservation) throw new Error('No reservation');
        await pool.query("UPDATE meduha_generation_jobs SET reservation_id=$2,status='queued',updated_at=now() WHERE id=$1 AND status='awaiting_reservation'", [job.id, held.reservation.id]);
      }
      await returnJob();
    } catch (error) {
      if (error instanceof FinanceError) await pool.query("UPDATE meduha_generation_jobs SET status='failed',error_message=$3,updated_at=now() WHERE account_id=$1 AND idempotency_key=$2 AND status='awaiting_reservation'", [account.id, body.idempotencyKey, error.message]);
      report(res, error);
    }
  });
  return router;
}
