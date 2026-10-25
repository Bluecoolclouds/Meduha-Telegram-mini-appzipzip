import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, meduhaAiChannels, meduhaAiModels, pool } from '@workspace/db';
import { CreateMeduhaGenerationBody } from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { FinanceError, getFinanceSettings, reserveCredits } from '../lib/finance';
import { SEEDANCE_MODEL } from '../lib/higgsfield';
import { generationVideoFile } from '../lib/objectStorage';
import { pipeStorageReadStream } from '../lib/storage-stream';

const fail = (res: Response, status: number, code: string, error: string) => res.status(status).json({ code, error });
type JobInput = { prompt: string; duration: number; aspect_ratio: string; resolution: string };

export function publicJob(row: Record<string, any>) {
  const isPhoto = !!row.input._photo;
  let resultUrls: string[] = [];
  if (isPhoto && row.status === 'completed') {
    try {
      const parsed = JSON.parse(row.result_url);
      if (Array.isArray(parsed)) resultUrls = parsed.filter((url, index) => url === `/api/meduha/generations/${row.id}/images/${index}`);
    } catch { /* Never expose provider URLs. */ }
  }
  return {
    id: row.id as string,
    idempotencyKey: row.idempotency_key as string,
    modelId: row.model_id as string,
    modelName: row.display_name as string,
    scenario: row.input._photo?.catalogId ?? row.input._video?.catalogId ?? row.input._genjutsu?.scenario ?? 'text-to-video',
    mediaKind: isPhoto ? 'photo' : 'video',
    resultUrls,
    prompt: row.input.prompt as string,
    duration: row.input.duration as number,
    aspectRatio: row.input.aspect_ratio as string,
    status: row.status as string,
    requestId: row.request_id as string | null,
    resultUrl: row.status === 'completed' ? isPhoto ? resultUrls[0] ?? null : row.result_url as string | null : null,
    error: row.error_message as string | null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    creditPrice: Number(row.credit_price),
  };
}

export function createMeduhaGenerationsRouter() {
  const router = Router();

  router.get('/catalog/prices', async (_req, res) => {
    const rows = await db.select({
      upstreamId: meduhaAiModels.upstreamId,
      creditPrice: meduhaAiModels.creditPrice,
    }).from(meduhaAiModels)
      .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
      .where(and(
        eq(meduhaAiModels.enabled, true),
        eq(meduhaAiChannels.enabled, true),
        eq(meduhaAiChannels.adapter, 'higgsfield'),
        eq(meduhaAiModels.kind, 'video'),
      ));
    res.set('Cache-Control', 'no-store').json({
      models: rows.filter(row => Number.isSafeInteger(row.creditPrice) && row.creditPrice > 0),
    });
  });

  router.get('/generations/models', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы запускать генерацию.'); return; }
    const [rows, settings] = await Promise.all([
      db.select({
        id: meduhaAiModels.id, displayName: meduhaAiModels.displayName, creditPrice: meduhaAiModels.creditPrice,
        limits: meduhaAiModels.limits,
      }).from(meduhaAiModels)
        .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
        .where(and(
          eq(meduhaAiModels.enabled, true),
          eq(meduhaAiChannels.enabled, true),
          eq(meduhaAiChannels.adapter, 'higgsfield'),
          eq(meduhaAiModels.upstreamId, SEEDANCE_MODEL),
        )),
      getFinanceSettings(),
    ]);
    res.json({
      spendingEnabled: settings.spendingEnabled,
      models: rows.filter(row => row.creditPrice > 0).map(row => ({ id: row.id, name: row.displayName, creditPrice: row.creditPrice, limits: row.limits })),
    });
  });

  router.get('/generations', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы увидеть генерации.'); return; }
    const result = await pool.query(
      `SELECT j.*, m.display_name
       FROM meduha_generation_jobs j JOIN meduha_ai_models m ON m.id = j.model_id
       WHERE j.account_id = $1 ORDER BY j.created_at DESC LIMIT 50`,
      [account.id],
    );
    res.json({ items: result.rows.map(publicJob) });
  });

  router.get('/generations/:id/video', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы посмотреть своё видео.'); return; }
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.sendStatus(404); return; }
    const result = await pool.query(
      `SELECT status, result_url FROM meduha_generation_jobs WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [req.params.id, account.id],
    );
    const job = result.rows[0] as { status?: string; result_url?: string | null } | undefined;
    const expectedUrl = `/api/meduha/generations/${encodeURIComponent(req.params.id)}/video`;
    if (job?.status !== 'completed' || job.result_url !== expectedUrl) { res.sendStatus(404); return; }

    const file = generationVideoFile(req.params.id);
    let metadata: { size?: string | number; contentType?: string };
    try { [metadata] = await file.getMetadata(); }
    catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 404) { res.sendStatus(404); return; }
      req.log.error({ jobId: req.params.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Generation video metadata lookup failed');
      fail(res, 503, 'VIDEO_TEMPORARILY_UNAVAILABLE', 'Не удалось загрузить видео. Попробуй позже.');
      return;
    }
    const size = Number(metadata.size);
    const contentType = metadata.contentType?.toLowerCase();
    if (!Number.isSafeInteger(size) || size < 8 || size > 512 * 1024 * 1024
      || !['video/mp4', 'video/webm', 'video/quicktime'].includes(contentType ?? '')) {
      req.log.error({ jobId: req.params.id }, 'Stored generation video metadata is invalid');
      fail(res, 503, 'VIDEO_TEMPORARILY_UNAVAILABLE', 'Не удалось загрузить видео. Попробуй позже.');
      return;
    }

    let start = 0, end = size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.status(416).set('Content-Range', `bytes */${size}`).end(); return;
      }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        res.status(416).set('Content-Range', `bytes */${size}`).end(); return;
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Disposition': req.query.download === '1'
        ? `attachment; filename="meduha-${req.params.id}.${contentType === 'video/webm' ? 'webm' : contentType === 'video/quicktime' ? 'mov' : 'mp4'}"`
        : 'inline',
    });
    const stream = file.createReadStream({ start, end });
    pipeStorageReadStream(stream, res, error => {
      req.log.error({ jobId: req.params.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Generation video stream failed');
    });
  });

  router.post('/generations', async (req, res) => {
    const account = await currentAccount(req);
    if (!account || account.blocked) { fail(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы запускать генерацию.'); return; }
    const parsed = CreateMeduhaGenerationBody.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'INVALID_INPUT', 'Проверь описание, длительность, формат и модель.'); return;
    }
    const { idempotencyKey, modelId, duration, aspectRatio } = parsed.data;
    const prompt = parsed.data.prompt.trim();
    if (!prompt) { fail(res, 400, 'INVALID_INPUT', 'Описание не может быть пустым.'); return; }
    const input: JobInput = { prompt, duration, aspect_ratio: aspectRatio, resolution: '720p' };
    const priorResult = await pool.query(
      `SELECT * FROM meduha_generation_jobs WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [account.id, idempotencyKey],
    );
    const priorJob = priorResult.rows[0] as Record<string, any> | undefined;
    if (priorJob) {
      const priorInput = priorJob.input as JobInput;
      if (priorJob.model_id !== modelId || priorInput.prompt !== input.prompt
        || priorInput.duration !== input.duration || priorInput.aspect_ratio !== input.aspect_ratio) {
        fail(res, 409, 'IDEMPOTENCY_CONFLICT', 'Ключ отправки уже использован для других параметров.'); return;
      }
      if (priorJob.status !== 'awaiting_reservation') {
        const result = await pool.query(
          `SELECT j.*, m.display_name FROM meduha_generation_jobs j
           JOIN meduha_ai_models m ON m.id = j.model_id WHERE j.id = $1`,
          [priorJob.id],
        );
        res.status(202).json({ job: publicJob(result.rows[0]) });
        return;
      }
    }

    const [model] = await db.select({
      id: meduhaAiModels.id, channelId: meduhaAiModels.channelId, upstreamId: meduhaAiModels.upstreamId,
      displayName: meduhaAiModels.displayName, enabled: meduhaAiModels.enabled,
      creditPrice: meduhaAiModels.creditPrice, limits: meduhaAiModels.limits,
      channelEnabled: meduhaAiChannels.enabled, adapter: meduhaAiChannels.adapter,
    }).from(meduhaAiModels)
      .innerJoin(meduhaAiChannels, eq(meduhaAiChannels.id, meduhaAiModels.channelId))
      .where(and(eq(meduhaAiModels.id, modelId), eq(meduhaAiModels.upstreamId, SEEDANCE_MODEL)))
      .limit(1);
    if (!model || model.adapter !== 'higgsfield'
      || (!priorJob && (!model.enabled || !model.channelEnabled))) {
      fail(res, 409, 'MODEL_UNAVAILABLE', 'Эта модель сейчас недоступна. Обнови список моделей.'); return;
    }
    const creditPrice = priorJob ? Number(priorJob.credit_price) : model.creditPrice;
    if (creditPrice <= 0) { fail(res, 409, 'MODEL_NOT_PRICED', 'Для модели ещё не настроена цена.'); return; }
    const limits = model.limits || {};
    const minDuration = Number.isInteger(limits.minDuration) ? limits.minDuration : 4;
    const maxDuration = Number.isInteger(limits.maxDuration) ? limits.maxDuration : 30;
    if (!priorJob && (duration < minDuration || duration > maxDuration)) {
      fail(res, 400, 'DURATION_OUT_OF_RANGE', `Для модели доступна длительность от ${minDuration} до ${maxDuration} секунд.`); return;
    }

    const id = randomUUID();
    const client = await pool.connect();
    let job: Record<string, any>;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO meduha_generation_jobs
         (id, account_id, model_id, channel_id, credit_price, idempotency_key, status, input)
         VALUES ($1,$2,$3,$4,$5,$6,'awaiting_reservation',$7::jsonb)
         ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING *`,
        [id, account.id, model.id, model.channelId, creditPrice, idempotencyKey, JSON.stringify(input)],
      );
      if (inserted.rows[0]) {
        job = inserted.rows[0];
      } else {
        const existing = await client.query(
          `SELECT * FROM meduha_generation_jobs WHERE account_id = $1 AND idempotency_key = $2 FOR UPDATE`,
          [account.id, idempotencyKey],
        );
        job = existing.rows[0];
        const priorInput = job?.input as JobInput | undefined;
        if (!job || job.model_id !== model.id || !priorInput
          || priorInput.prompt !== input.prompt || priorInput.duration !== input.duration
          || priorInput.aspect_ratio !== input.aspect_ratio || priorInput.resolution !== input.resolution) {
          await client.query('ROLLBACK');
          fail(res, 409, 'IDEMPOTENCY_CONFLICT', 'Ключ отправки уже использован для других параметров.'); return;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (job.status === 'awaiting_reservation') {
      try {
        const held = await reserveCredits({
          accountId: account.id, actorId: account.id, amount: Number(job.credit_price),
          reason: `Seedance 2.5 · ${duration}s`, modelId: model.id,
          idempotencyKey: `generation-reserve:${account.id}:${idempotencyKey}`,
        });
        if (!held.reservation) throw new Error('Credit reservation was not created.');
        await pool.query(
          `UPDATE meduha_generation_jobs SET reservation_id = $2, status = 'queued', updated_at = now()
           WHERE id = $1 AND status = 'awaiting_reservation'`,
          [job.id, held.reservation.id],
        );
      } catch (error) {
        if (error instanceof FinanceError) {
          await pool.query(
            `UPDATE meduha_generation_jobs SET status = 'failed', error_message = $2, updated_at = now()
             WHERE id = $1 AND status = 'awaiting_reservation'`,
            [job.id, error.message],
          ).catch(() => undefined);
          const code = error.code;
          fail(res, 409, code, error.message); return;
        }
        // A database response can be lost after reserveCredits commits. Keep the
        // job resumable so the same finance idempotency key can recover the hold.
        throw error;
      }
      const refreshed = await pool.query(
        `SELECT j.*, m.display_name FROM meduha_generation_jobs j
         JOIN meduha_ai_models m ON m.id = j.model_id WHERE j.id = $1`,
        [job.id],
      );
      res.status(202).json({ job: publicJob(refreshed.rows[0]) });
      return;
    }
    const refreshed = await pool.query(
      `SELECT j.*, m.display_name FROM meduha_generation_jobs j
       JOIN meduha_ai_models m ON m.id = j.model_id WHERE j.id = $1`,
      [job.id],
    );
    res.status(202).json({ job: publicJob(refreshed.rows[0]) });
  });
  return router;
}
