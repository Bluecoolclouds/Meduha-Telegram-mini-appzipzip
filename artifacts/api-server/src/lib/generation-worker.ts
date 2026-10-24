import { pool } from '@workspace/db';
import { logger } from './logger';
import { completedVideo, getHiggsfieldRequestStatus, higgsfieldClient, SEEDANCE_MODEL } from './higgsfield';
import { releaseReservation, settleReservation } from './finance';
import { genjutsuProviderInput, type GenjutsuMetadata } from './genjutsu';
import { GenerationVideoValidationError, storeGenerationVideo } from './objectStorage';
import { photoProviderInput, type PhotoMetadata } from './photo';
import { storeGenerationImages, PhotoResultValidationError } from './photo-storage';
import { videoProviderInput, type VideoMetadata } from './video';

type GenerationJob = {
  id: string;
  account_id: string;
  model_id: string;
  channel_id: string;
  reservation_id: string;
  request_id: string | null;
  status: string;
  input: { prompt: string; duration: number; aspect_ratio: string; resolution: string; _genjutsu?: GenjutsuMetadata; _photo?: PhotoMetadata; _video?: VideoMetadata };
  provider_status: string | null;
  result_url: string | null;
  resolution_outcome?: 'completed' | 'failed' | null;
  resolution_by?: string | null;
  resolution_reason?: string | null;
};
type ProviderSubmission = { status: string; request_id?: string; video?: { url?: string }; images?: { url: string }[] };
type ProviderStatus = { status: string; video?: { url?: string }; images?: { url: string }[] };
type WorkerDependencies = {
  submit?: (input: GenerationJob['input']) => Promise<ProviderSubmission>;
  getStatus?: (requestId: string) => Promise<ProviderStatus>;
  storeVideo?: typeof storeGenerationVideo;
  storeImages?: typeof storeGenerationImages;
};
export type GenerationVideoStore = typeof storeGenerationVideo;
class ProviderPreparationError extends Error {}
const jobLabel = (job: GenerationJob) => job.input._photo ? 'Photo' : job.input._video ? 'Video' : job.input._genjutsu ? 'Genjutsu' : 'Seedance';
const actorFor = (job: GenerationJob) => `generation:${job.id}`;
const transitionKey = (job: GenerationJob, operation: string) => `generation:${job.id}:${operation}`;

async function claimQueuedJob(): Promise<GenerationJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM meduha_generation_jobs
       WHERE status = 'queued'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const job = rows[0] as GenerationJob | undefined;
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    const claimed = await client.query(
      `UPDATE meduha_generation_jobs SET status = 'submitting', updated_at = now()
       WHERE id = $1 AND status = 'queued'
       RETURNING *`,
      [job.id],
    );
    await client.query('COMMIT');
    return claimed.rows[0] as GenerationJob | undefined ?? null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function closeReservation(
  job: GenerationJob,
  outcome: 'completed' | 'failed',
  resultUrl: string | null,
  providerStatus: string,
  storeVideo: GenerationVideoStore = storeGenerationVideo,
  failureMessage?: string,
  storeImages: typeof storeGenerationImages = storeGenerationImages,
): Promise<boolean | void> {
  const updated = await pool.query(
    `UPDATE meduha_generation_jobs
     SET status = 'finalizing', provider_status = $2, result_url = $3, error_message = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'submitting', 'in_progress', 'unknown', 'finalizing')
     RETURNING id`,
    [job.id, providerStatus, resultUrl],
  );
  if (!updated.rowCount) return;
  if (outcome === 'completed') {
    return finalizeCompletedGeneration({
      ...job,
      status: 'finalizing',
      provider_status: providerStatus,
      result_url: resultUrl,
    }, storeVideo, storeImages);
  }
  const financeInput = {
    reservationId: job.reservation_id,
    actorId: actorFor(job),
    idempotencyKey: transitionKey(job, 'release'),
    reason: `${jobLabel(job)} generation ${providerStatus}`,
  };
  await releaseReservation(financeInput);
  await pool.query(
    `UPDATE meduha_generation_jobs SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1 AND status = 'finalizing'`,
    [job.id, failureMessage ?? null],
  );
}

async function finalizeCompletedGeneration(job: GenerationJob, storeVideo: GenerationVideoStore = storeGenerationVideo, storeImages = storeGenerationImages) {
  if (job.input._photo) return finalizeCompletedPhoto(job, storeImages);
  const resultUrl = `/api/meduha/generations/${encodeURIComponent(job.id)}/video`;
  if (job.result_url !== resultUrl) {
    const providerUrl = job.result_url;
    if (!providerUrl) throw new Error('Completed generation has no saved provider video URL');
    try {
      await storeVideo(job.id, providerUrl);
    } catch (error) {
      if (error instanceof GenerationVideoValidationError) {
        await closeReservation(
          job, 'failed', null, 'invalid_video', storeVideo,
          'Результат провайдера не прошёл проверку, поэтому видео не сохранено.',
        );
        logger.warn({ jobId: job.id, errorName: error.name }, 'Completed generation video rejected by validation');
        return false;
      }
      await pool.query(
        `UPDATE meduha_generation_jobs
         SET error_message = 'Не удалось сохранить видео. Повторяем попытку автоматически.', updated_at = now()
         WHERE id = $1 AND status = 'finalizing' AND provider_status = 'completed'`,
        [job.id],
      );
      logger.warn({ jobId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Completed generation video storage failed');
      return false;
    }
    await pool.query(
      `UPDATE meduha_generation_jobs
       SET result_url = $2, error_message = NULL, updated_at = now()
       WHERE id = $1 AND status = 'finalizing' AND provider_status = 'completed'`,
      [job.id, resultUrl],
    );
  }

  const financeInput = {
    reservationId: job.reservation_id,
    actorId: actorFor(job),
    idempotencyKey: transitionKey(job, 'settle'),
    reason: `${jobLabel(job)} generation completed`,
  };
  await settleReservation(financeInput);
  await pool.query(
    `UPDATE meduha_generation_jobs SET status = 'completed', updated_at = now()
     WHERE id = $1 AND status = 'finalizing' AND provider_status = 'completed' AND resolution_outcome IS NULL`,
    [job.id],
  );
  return true;
}

async function finalizeCompletedPhoto(job: GenerationJob, storeImages = storeGenerationImages) {
  let urls: string[];
  try {
    urls = JSON.parse(job.result_url ?? 'null');
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string')) throw new PhotoResultValidationError('Invalid photo result');
    const isPrivate = urls.every((url, index) => url === `/api/meduha/generations/${job.id}/images/${index}`);
    if (!isPrivate) {
      urls = await storeImages(job.id, urls);
      await pool.query(`UPDATE meduha_generation_jobs SET result_url=$2,error_message=NULL,updated_at=now() WHERE id=$1 AND status='finalizing' AND provider_status='completed'`, [job.id, JSON.stringify(urls)]);
    }
  } catch (error) {
    if (error instanceof GenerationVideoValidationError) {
      await closeReservation(job, 'failed', null, 'invalid_image', storeGenerationVideo, 'Поставщик вернул недопустимое изображение. Резерв снят.');
    } else {
      await pool.query(`UPDATE meduha_generation_jobs SET error_message='Не удалось сохранить фото. Повторяем сохранение автоматически.',updated_at=now() WHERE id=$1 AND status='finalizing'`, [job.id]);
      logger.warn({ jobId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Photo result storage failed');
    }
    return false;
  }
  await settleReservation({ reservationId: job.reservation_id, actorId: actorFor(job), idempotencyKey: transitionKey(job, 'settle'), reason: 'Photo generation completed' });
  await pool.query(`UPDATE meduha_generation_jobs SET status='completed',updated_at=now() WHERE id=$1 AND status='finalizing' AND provider_status='completed' AND resolution_outcome IS NULL`, [job.id]);
  return true;
}

async function recoverFinalizingJobs(storeVideo: GenerationVideoStore = storeGenerationVideo, storeImages = storeGenerationImages) {
  const { rows } = await pool.query(
    `SELECT * FROM meduha_generation_jobs WHERE status = 'finalizing' ORDER BY updated_at LIMIT 10`,
  );
  for (const job of rows as GenerationJob[]) {
    try {
      const outcome = job.resolution_outcome ?? (job.provider_status === 'completed' ? 'completed' : 'failed');
      if (outcome === 'completed' && !job.resolution_outcome) {
        await finalizeCompletedGeneration(job, storeVideo, storeImages);
        continue;
      }
      const financeInput = {
        reservationId: job.reservation_id,
        actorId: job.resolution_by ?? actorFor(job),
        idempotencyKey: job.resolution_by
          ? transitionKey(job, `admin-resolution-${outcome}`)
          : transitionKey(job, outcome === 'completed' ? 'settle' : 'release'),
        reason: job.resolution_reason
          ? `Seedance admin resolution: ${job.resolution_reason}`
          : `${jobLabel(job)} generation ${job.provider_status ?? outcome}`,
      };
      if (outcome === 'completed') await settleReservation(financeInput);
      else await releaseReservation(financeInput);
      await pool.query(`UPDATE meduha_generation_jobs SET status = $2, updated_at = now() WHERE id = $1 AND status = 'finalizing'`, [job.id, outcome]);
    } catch (error) {
      logger.error({ jobId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Generation reservation finalization failed');
    }
  }
}

export async function finalizeResolvedGeneration(jobId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM meduha_generation_jobs
     WHERE id = $1 AND status = 'finalizing' AND resolution_outcome IS NOT NULL`,
    [jobId],
  );
  const job = rows[0] as GenerationJob | undefined;
  if (!job) return false;
  const outcome = job.resolution_outcome!;
  const financeInput = {
    reservationId: job.reservation_id,
    actorId: job.resolution_by ?? actorFor(job),
    idempotencyKey: transitionKey(job, `admin-resolution-${outcome}`),
    reason: `Seedance admin resolution: ${job.resolution_reason ?? outcome}`,
  };
  if (outcome === 'completed') await settleReservation(financeInput);
  else await releaseReservation(financeInput);
  await pool.query(
    `UPDATE meduha_generation_jobs SET status = $2, updated_at = now()
     WHERE id = $1 AND status = 'finalizing' AND resolution_outcome = $3`,
    [job.id, outcome, outcome],
  );
  return true;
}

async function applyCompletedProviderResult(job: GenerationJob, result: ProviderStatus, storeVideo: GenerationVideoStore, storeImages = storeGenerationImages) {
  if (job.input._photo) {
    const urls = result.images?.map(image => image.url);
    const expected = Number(job.input._photo.parameters.batch_size ?? 1);
    if (!urls?.length || urls.length !== expected || urls.length > 8 || urls.some(url => typeof url !== 'string' || !url.startsWith('https://'))) {
      await closeReservation(job, 'failed', null, 'invalid_image', storeVideo, 'Поставщик не вернул ожидаемые изображения. Резерв снят.');
      return false;
    }
    await closeReservation(job, 'completed', JSON.stringify(urls), 'completed', storeVideo, undefined, storeImages);
    return true;
  }
  const sourceUrl = result.video?.url;
  let resultUrl: string;
  try {
    resultUrl = completedVideo({ status: 'completed', video: { url: sourceUrl ?? '' } });
  } catch {
    await closeReservation(
      job, 'failed', null, 'invalid_video', storeVideo,
      'Поставщик не вернул допустимую ссылку на видео. Резерв снят.',
    );
    return false;
  }
  await closeReservation(job, 'completed', resultUrl, 'completed', storeVideo);
  return true;
}

export async function applyGenerationProviderStatus(
  jobId: string,
  result: ProviderStatus,
  storeVideo: GenerationVideoStore = storeGenerationVideo,
  storeImages = storeGenerationImages,
) {
  const { rows } = await pool.query(
    `SELECT * FROM meduha_generation_jobs
     WHERE id = $1 AND status IN ('unknown', 'in_progress') AND request_id IS NOT NULL`,
    [jobId],
  );
  const job = rows[0] as GenerationJob | undefined;
  if (!job) return false;
  if (result.status === 'completed') {
    await applyCompletedProviderResult(job, result, storeVideo, storeImages);
  } else if (result.status === 'failed' || result.status === 'nsfw' || result.status === 'canceled') {
    await closeReservation(job, 'failed', null, result.status, storeVideo);
  } else {
    await pool.query(
      `UPDATE meduha_generation_jobs SET status = 'in_progress', provider_status = $2,
          error_message = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('unknown', 'in_progress') AND request_id IS NOT NULL`,
      [job.id, result.status],
    );
  }
  return true;
}

async function submitNextJob(submit: WorkerDependencies['submit'], storeVideo: GenerationVideoStore, storeImages = storeGenerationImages) {
  const job = await claimQueuedJob();
  if (!job) return;
  let responseRequestId: string | null = null;
  try {
    // SDK retries are disabled: this POST is billable and a lost response is ambiguous.
    const send = submit ?? (async (input: GenerationJob['input']) => {
      if (input._photo) {
        let providerInput: Record<string, unknown>;
        try { providerInput = await photoProviderInput(job.account_id, input._photo); }
        catch { throw new ProviderPreparationError('Photo inputs unavailable'); }
        // Only allowlisted endpoint and validated inputs reach this billable POST.
        return higgsfieldClient().subscribe(input._photo.endpoint, { input: providerInput, withPolling: false });
      }
      if (input._video) {
        let providerInput;
        try { providerInput = await videoProviderInput(job.account_id, input._video); }
        catch { throw new ProviderPreparationError('Не удалось подготовить настройки или приватные референсы видео.'); }
        return higgsfieldClient().subscribe(input._video.endpoint, { input: providerInput, withPolling: false });
      }
      if (input._genjutsu) {
        let providerInput: Awaited<ReturnType<typeof genjutsuProviderInput>>;
        try {
          providerInput = await genjutsuProviderInput({ ...input, _genjutsu: input._genjutsu });
        } catch {
          throw new ProviderPreparationError('Generation inputs unavailable');
        }
        return higgsfieldClient().subscribe(input._genjutsu.endpoint, { input: providerInput, withPolling: false });
      }
      return higgsfieldClient().subscribe(SEEDANCE_MODEL, { input, withPolling: false });
    });
    const response = await send(job.input);
    responseRequestId = response.request_id ?? null;
    if (!response.request_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(response.request_id)) {
      await pool.query(
        `UPDATE meduha_generation_jobs SET status = 'unknown', error_message = $2, updated_at = now() WHERE id = $1 AND status = 'submitting'`,
        [job.id, 'Поставщик не подтвердил ID запроса. Отправка не будет повторена автоматически.'],
      );
      return;
    }
    if (response.status === 'completed') {
      await pool.query(`UPDATE meduha_generation_jobs SET request_id=$2 WHERE id=$1 AND status='submitting'`, [job.id, response.request_id]);
      await applyCompletedProviderResult({ ...job, request_id: response.request_id }, response, storeVideo, storeImages);
      return;
    }
    if (response.status === 'failed' || response.status === 'nsfw' || response.status === 'canceled') {
      await pool.query(
        `UPDATE meduha_generation_jobs SET request_id = $2, status = 'finalizing', provider_status = $3, updated_at = now()
         WHERE id = $1 AND status = 'submitting'`,
        [job.id, response.request_id, response.status],
      );
      await closeReservation({ ...job, request_id: response.request_id, status: 'finalizing' }, 'failed', null, response.status, storeVideo);
      return;
    }
    await pool.query(
      `UPDATE meduha_generation_jobs SET request_id = $2, status = 'in_progress', provider_status = $3, updated_at = now()
       WHERE id = $1 AND status = 'submitting'`,
      [job.id, response.request_id, response.status],
    );
  } catch (error) {
    if (error instanceof ProviderPreparationError) {
      await pool.query(
        `UPDATE meduha_generation_jobs SET status = 'finalizing', provider_status = 'input_unavailable',
           error_message = 'Не удалось подготовить файлы для поставщика. Генерация не отправлена.', updated_at = now()
         WHERE id = $1 AND status = 'submitting'`, [job.id],
      );
      await closeReservation({ ...job, status: 'finalizing' }, 'failed', null, 'input_unavailable', storeVideo);
      return;
    }
    logger.error({ jobId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Seedance submit outcome is unknown; automatic retry suppressed');
    await pool.query(
      `UPDATE meduha_generation_jobs SET status = 'unknown', request_id = COALESCE(request_id, $3),
          error_message = $2, updated_at = now()
       WHERE id = $1 AND status = 'submitting'`,
      [job.id, 'Не удалось подтвердить отправку. Списание зарезервировано; автоматической повторной отправки не будет.', responseRequestId],
    ).catch(() => undefined);
  }
}

async function pollJobs(getStatus: WorkerDependencies['getStatus'], storeVideo: GenerationVideoStore, storeImages = storeGenerationImages) {
  await pool.query(
    `UPDATE meduha_generation_jobs
     SET status = 'unknown',
         error_message = 'Сервер перезапустился во время отправки. Повторная отправка отключена.',
         updated_at = now()
     WHERE status = 'submitting' AND updated_at < now() - interval '2 minutes'`,
  );
  const { rows } = await pool.query(
    `SELECT * FROM meduha_generation_jobs
     WHERE status IN ('in_progress', 'unknown') AND request_id IS NOT NULL
     ORDER BY updated_at LIMIT 10`,
  );
  for (const job of rows as GenerationJob[]) {
    try {
      const readStatus = getStatus ?? getHiggsfieldRequestStatus;
      const result = await readStatus(job.request_id!);
      if (result.status === 'completed') {
        await applyCompletedProviderResult(job, result, storeVideo, storeImages);
      } else if (result.status === 'failed' || result.status === 'nsfw' || result.status === 'canceled') {
        await closeReservation(job, 'failed', null, result.status, storeVideo);
      } else if (result.status !== job.provider_status) {
        await pool.query(
          `UPDATE meduha_generation_jobs SET status = 'in_progress', provider_status = $2,
              error_message = NULL, updated_at = now()
           WHERE id = $1 AND status IN ('in_progress', 'unknown')`,
          [job.id, result.status],
        );
      }
    } catch (error) {
      logger.warn({ jobId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Seedance status check failed');
    }
  }
}

let active = false;
export async function runGenerationWorkerOnce(dependencies: WorkerDependencies = {}) {
  const storeVideo = dependencies.storeVideo ?? storeGenerationVideo;
  const storeImages = dependencies.storeImages ?? storeGenerationImages;
  await recoverFinalizingJobs(storeVideo, storeImages);
  await submitNextJob(dependencies.submit, storeVideo, storeImages);
  await pollJobs(dependencies.getStatus, storeVideo, storeImages);
}

export function startGenerationWorker(): () => void {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runGenerationWorkerOnce();
    } catch (error) {
      logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Generation worker iteration failed');
    } finally {
      running = false;
    }
  };
  if (active) return () => undefined;
  active = true;
  const timer = setInterval(() => void run(), 2500);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    active = false;
    clearInterval(timer);
  };
}

