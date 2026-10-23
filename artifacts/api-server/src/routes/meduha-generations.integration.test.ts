import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { spawn } from 'node:child_process';
import { pool } from '@workspace/db';
import { getFinanceSettings, getWallet, reserveCredits, updateFinanceSettings } from '../lib/finance';
import { runGenerationWorkerOnce } from '../lib/generation-worker';
import { createMeduhaRouter } from './meduha';

type GenerationWorkerProcess = {
  child: ReturnType<typeof spawn>;
  ready: Promise<void>;
  complete: Promise<{ submitCalls: number }>;
};

function spawnGenerationWorker(providerRequestId: string): GenerationWorkerProcess {
  const child = spawn(process.execPath, [process.argv[1]], {
    env: {
      ...process.env,
      GENERATION_MULTIPROCESS_WORKER: '1',
      GENERATION_MULTIPROCESS_REQUEST_ID: providerRequestId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let readyResolved = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (!readyResolved && stdout.includes('READY\n')) {
      readyResolved = true;
      resolveReady();
    }
  });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.once('error', error => rejectReady(error));
  child.once('close', code => {
    if (!readyResolved) rejectReady(new Error(`worker exited before ready (${code}): ${stderr}`));
  });
  const complete = new Promise<{ submitCalls: number }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(`generation worker exited with ${code}: ${stderr}`));
        return;
      }
      try {
        const output = stdout.trim().split('\n').filter(line => line && line !== 'READY').at(-1);
        assert(output, `generation worker returned no result; stderr: ${stderr}`);
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
  });
  return { child, ready, complete };
}

async function runGenerationWorkerProcess(): Promise<void> {
  const requestId = process.env.GENERATION_MULTIPROCESS_REQUEST_ID;
  if (!requestId) throw new Error('Missing provider request ID for worker process.');
  process.stdout.write('READY\n');
  await new Promise<void>((resolve, reject) => {
    process.stdin.once('data', () => resolve());
    process.stdin.once('error', reject);
  });
  let submitCalls = 0;
  await runGenerationWorkerOnce({
    submit: async () => {
      submitCalls++;
      await new Promise(resolve => setTimeout(resolve, 150));
      return { status: 'queued', request_id: requestId };
    },
    getStatus: async () => ({ status: 'queued' }),
  });
  await pool.end();
  process.stdout.write(`${JSON.stringify({ submitCalls })}\n`);
}

if (process.env.GENERATION_MULTIPROCESS_WORKER === '1') {
  void runGenerationWorkerProcess().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
test('generation queue claims a billable request once across independent worker processes', async () => {
  const userId = `generation-race-${randomUUID()}`;
  const channelId = randomUUID();
  const modelId = randomUUID();
  const jobId = randomUUID();
  const idempotencyKey = randomUUID();
  const reservationKey = `generation-race-reserve:${idempotencyKey}`;
  const previousSettings = await getFinanceSettings();

  try {
    await pool.query(
      `INSERT INTO meduha_accounts (id, first_name, credits) VALUES ($1, 'Generation race fixture', 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO meduha_ai_channels
       (id,name,base_url,adapter,enabled,priority,concurrency_limit,daily_credit_limit)
       VALUES ($1,'Generation race test','https://api.higgsfield.ai','higgsfield',true,10,100,100000)`,
      [channelId],
    );
    await pool.query(
      `INSERT INTO meduha_ai_models
       (id,channel_id,upstream_id,display_name,kind,enabled,credit_price,limits)
       VALUES ($1,$2,'bytedance/seedance-2.5/text-to-video','Seedance race test','video',true,20,
         '{"minDuration":4,"maxDuration":30,"concurrencyLimit":100,"dailyCreditLimit":100000}'::jsonb)`,
      [modelId, channelId],
    );
    await updateFinanceSettings({
      spendingEnabled: true, dailyCreditLimit: 100000, maxActiveReservations: 100,
    }, 'generation-race-test');
    const held = await reserveCredits({
      accountId: userId,
      actorId: userId,
      amount: 20,
      modelId,
      reason: 'Seedance multiprocess race test',
      idempotencyKey: reservationKey,
    });
    assert(held.reservation, 'the queued generation must have a reservation');
    await pool.query(
      `INSERT INTO meduha_generation_jobs
       (id, account_id, model_id, channel_id, credit_price, idempotency_key, reservation_id, status, input)
       VALUES ($1,$2,$3,$4,20,$5,$6,'queued',$7::jsonb)`,
      [jobId, userId, modelId, channelId, idempotencyKey, held.reservation.id,
        JSON.stringify({ prompt: 'A lighthouse in winter', duration: 5, aspect_ratio: '16:9', resolution: '720p' })],
    );

    const providerRequestId = `cross-process-${randomUUID()}`;
    const workers = [
      spawnGenerationWorker(providerRequestId),
      spawnGenerationWorker(providerRequestId),
    ];
    await Promise.all(workers.map(worker => worker.ready));
    for (const worker of workers) {
      assert(worker.child.stdin);
      worker.child.stdin.end('GO\n');
    }
    const workerResults = await Promise.all(workers.map(worker => worker.complete));
    assert.equal(workerResults.reduce((total, result) => total + result.submitCalls, 0), 1,
      'two independent worker processes submit the queued billable request exactly once');

    const jobState = await pool.query(
      `SELECT status, request_id, reservation_id FROM meduha_generation_jobs WHERE id = $1`,
      [jobId],
    );
    assert.equal(jobState.rows[0]?.status, 'in_progress');
    assert.equal(jobState.rows[0]?.request_id, providerRequestId,
      'the provider request ID returned by the single submit is saved');
    assert.equal(jobState.rows[0]?.reservation_id, held.reservation.id);
    const heldReservation = await pool.query(
      `SELECT count(*)::int AS count FROM meduha_credit_reservations
       WHERE id = $1 AND account_id = $2 AND status = 'held'`,
      [held.reservation.id, userId],
    );
    assert.equal(heldReservation.rows[0]?.count, 1, 'the job retains exactly one held reservation');

    const polledRequestIds: string[] = [];
    await runGenerationWorkerOnce({
      submit: async () => { assert.fail('an in-progress generation must never be submitted again'); },
      getStatus: async requestId => {
        if (requestId === providerRequestId) {
          polledRequestIds.push(requestId);
          return { status: 'completed', video: { url: 'https://media.example.test/cross-process.mp4' } };
        }
        return { status: 'queued' };
      },
      storeVideo: async () => ({ size: 24, contentType: 'video/mp4' }),
    });
    assert.deepEqual(polledRequestIds, [providerRequestId],
      'the next worker poll uses the exact request ID saved by the winning process');
    const completedJob = await pool.query(
      `SELECT status, request_id, result_url FROM meduha_generation_jobs WHERE id = $1`,
      [jobId],
    );
    assert.equal(completedJob.rows[0]?.status, 'completed');
    assert.equal(completedJob.rows[0]?.request_id, providerRequestId);
    assert.equal(completedJob.rows[0]?.result_url, `/api/meduha/generations/${jobId}/video`);
    assert.equal((await getWallet(userId)).reservations.filter(item => item.status === 'held').length, 0,
      'completion settles the one reservation');
  } finally {
    await pool.query('DELETE FROM meduha_generation_jobs WHERE id = $1', [jobId]);
    const { rows } = await pool.query(
      `SELECT id FROM meduha_credit_reservations WHERE account_id = $1`,
      [userId],
    );
    const reservationIds = rows.map(row => row.id);
    if (reservationIds.length) {
      await pool.query('DELETE FROM meduha_finance_idempotency WHERE reservation_id = ANY($1::text[])', [reservationIds]);
    }
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = $1', [userId]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id = $1', [userId]);
    await pool.query('DELETE FROM meduha_accounts WHERE id = $1', [userId]);
    await pool.query('DELETE FROM meduha_ai_models WHERE id = $1', [modelId]);
    await pool.query('DELETE FROM meduha_ai_channels WHERE id = $1', [channelId]);
    await updateFinanceSettings({
      spendingEnabled: previousSettings.spendingEnabled,
      dailyCreditLimit: previousSettings.dailyCreditLimit,
      maxActiveReservations: previousSettings.maxActiveReservations,
    }, 'generation-race-test-cleanup');
  }
});

test('generation API checks configuration, reserves once, and never resubmits after an ambiguous provider response', async t => {
  const userId = `generation-fixture-${randomUUID()}`;
  const otherUserId = `generation-other-${randomUUID()}`;
  const channelId = randomUUID();
  const modelId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const otherToken = randomBytes(32).toString('hex');
  const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
  const previousSettings = await getFinanceSettings();
  let server: Server;
  let call!: (path: string, method?: string, body?: unknown, cookie?: string) => Promise<Response>;
  let submitCalls = 0;
  let videoCopyCalls = 0;
  const storeVideoForTest = async () => {
    videoCopyCalls++;
    return { size: 24, contentType: 'video/mp4' };
  };
  let adminProviderStatus: { status: string; video?: { url?: string } } = { status: 'queued' };
  let adminStatusBarrier: Promise<void> | null = null;
  let signalAdminStatusStarted: (() => void) | null = null;

  try {
    await pool.query(
      `INSERT INTO meduha_accounts (id, first_name, credits) VALUES ($1, 'Generation fixture', 100), ($2, 'Other fixture', 100)`,
      [userId, otherUserId],
    );
    await pool.query(
      `INSERT INTO meduha_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')`,
      [tokenHash(token), userId, tokenHash(otherToken), otherUserId],
    );
    await pool.query(
      `INSERT INTO meduha_ai_channels
       (id,name,base_url,adapter,enabled,priority,concurrency_limit,daily_credit_limit)
       VALUES ($1,'Generation test','https://api.higgsfield.ai','higgsfield',false,10,100,100000)`,
      [channelId],
    );
    await pool.query(
      `INSERT INTO meduha_ai_models
       (id,channel_id,upstream_id,display_name,kind,enabled,credit_price,limits)
       VALUES ($1,$2,'bytedance/seedance-2.5/text-to-video','Seedance test','video',true,20,
          '{"minDuration":4,"maxDuration":30,"concurrencyLimit":100,"dailyCreditLimit":100000}'::jsonb)`,
      [modelId, channelId],
    );
    await updateFinanceSettings({ spendingEnabled: false, dailyCreditLimit: 100000, maxActiveReservations: 100 }, 'generation-test');

    const app = express();
    app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/meduha', createMeduhaRouter(
      () => undefined, async () => null, async id => id === userId, false, undefined,
      async () => {
        if (adminStatusBarrier) {
          signalAdminStatusStarted?.();
          await adminStatusBarrier;
        }
        return adminProviderStatus;
      },
      {},
      storeVideoForTest,
    ));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address();
    assert(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api/meduha`;
    call = (path, method = 'GET', body?, cookie = `meduha_session=${token}`) => fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-meduha-request': '1', cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const unauthorized = await call('/generations/models', 'GET', undefined, '');
    assert.equal(unauthorized.status, 401);
    const hidden = await (await call('/generations/models')).json() as { models: unknown[] };
    assert.equal(hidden.models.length, 0, 'disabled channel is not offered to users');
    await pool.query('UPDATE meduha_ai_channels SET enabled = true WHERE id = $1', [channelId]);
    const unpricedState = await (await call('/generations/models')).json() as { spendingEnabled: boolean; models: unknown[] };
    assert.equal(unpricedState.spendingEnabled, false);
    assert.equal(unpricedState.models.length, 1, 'only the enabled configured model is listed');

    const disabledInput = { idempotencyKey: randomUUID(), modelId, prompt: 'A city at sunset', duration: 5, aspectRatio: '16:9' };
    const disabled = await call('/generations', 'POST', disabledInput);
    assert.equal(disabled.status, 409, 'global spending switch blocks new jobs');
    assert.equal((await getWallet(userId)).reservations.length, 0, 'disabled spending creates no credit reservation');

    await updateFinanceSettings({ spendingEnabled: true }, 'generation-test');
    const firstInput = { ...disabledInput, idempotencyKey: randomUUID() };
    const parallel = await Promise.all([
      call('/generations', 'POST', firstInput),
      call('/generations', 'POST', firstInput),
    ]);
    const accepted = await Promise.all(parallel.map(async response => {
      assert.equal(response.status, 202);
      return (await response.json() as { job: { id: string; status: string } }).job;
    }));
    assert.equal(accepted[0].id, accepted[1].id, 'replays return the original queue job');
    assert.equal(accepted[0].status, 'queued');
    assert.equal((await getWallet(userId)).reservations.filter(item => item.status === 'held').length, 1);
    const alteredReplay = await call('/generations', 'POST', { ...firstInput, prompt: 'Different work' });
    assert.equal(alteredReplay.status, 409, 'same key cannot be reused for different work');

    await runGenerationWorkerOnce({
      submit: async () => { submitCalls++; throw new Error('simulated lost response'); },
      getStatus: async () => ({ status: 'queued' }),
    });
    const uncertain = await (await call('/generations')).json() as { items: Array<{ id: string; status: string; requestId: string | null }> };
    assert.equal(uncertain.items.find(item => item.id === accepted[0].id)?.status, 'unknown');
    assert.equal(uncertain.items.find(item => item.id === accepted[0].id)?.requestId, null);
    await runGenerationWorkerOnce({ submit: async () => { submitCalls++; throw new Error('must not resubmit'); } });
    assert.equal(submitCalls, 1, 'an unknown paid POST is not retried');
    const uncertainWallet = await getWallet(userId);
    assert.equal(uncertainWallet.reservations.filter(item => item.status === 'held').length, 1);
    const unresolvedAdminList = await call('/admin/generations/seedance');
    assert.equal(unresolvedAdminList.status, 200);
    const unresolvedItems = (await unresolvedAdminList.json() as {
      items: Array<{ id: string; reservationStatus: string; reservationAgeSeconds: number | null }>;
    }).items;
    const unresolvedAdminJob = unresolvedItems.find(item => item.id === accepted[0].id);
    assert.equal(unresolvedAdminJob?.reservationStatus, 'held');
    assert.equal(typeof unresolvedAdminJob?.reservationAgeSeconds, 'number');
    assert((unresolvedAdminJob?.reservationAgeSeconds ?? -1) >= 0, 'reservation age is non-negative');
    assert.equal((await call('/admin/generations/seedance', 'GET', undefined, `meduha_session=${otherToken}`)).status, 403,
      'an ordinary account cannot review or resolve Seedance jobs');
    const missingReason = await call(`/admin/generations/seedance/${accepted[0].id}/resolve`, 'POST', { outcome: 'failed', reason: 'no' });
    assert.equal(missingReason.status, 400, 'manual resolution requires an audited explanation');
    assert.equal((await getWallet(userId)).reservations.filter(item => item.status === 'held').length, 1,
      'an invalid manual resolution does not release credits');
    const manualResolution = await call(`/admin/generations/seedance/${accepted[0].id}/resolve`, 'POST', {
      outcome: 'failed', reason: 'Confirmed no provider job exists after checking the account.',
    });
    assert.equal(manualResolution.status, 200);
    const manuallyResolved = await (await call('/generations')).json() as { items: Array<{ id: string; status: string }> };
    assert.equal(manuallyResolved.items.find(item => item.id === accepted[0].id)?.status, 'failed');
    const resolutionAudit = await pool.query(
      `SELECT action, details FROM meduha_admin_audit WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`,
      [accepted[0].id],
    );
    assert.equal(resolutionAudit.rows[0]?.action, 'generation.manual.resolve');
    assert.equal(resolutionAudit.rows[0]?.details.reason, 'Confirmed no provider job exists after checking the account.');
    assert.equal((await getWallet(userId)).reservations.filter(item => item.status === 'held').length, 0,
      'the explicit confirmed failure releases the hold');
    const replayedResolution = await call(`/admin/generations/seedance/${accepted[0].id}/resolve`, 'POST', {
      outcome: 'failed', reason: 'Confirmed no provider job exists after checking the account.',
    });
    assert.equal(replayedResolution.status, 200, 'repeating the same audited resolution is accepted after a lost response');
    assert.equal((await replayedResolution.json() as { replayed: boolean }).replayed, true,
      'the repeated manual resolution is identified as a replay');
    const conflictingResolution = await call(`/admin/generations/seedance/${accepted[0].id}/resolve`, 'POST', {
      outcome: 'completed', reason: 'A conflicting provider outcome was later reported.',
    });
    assert.equal(conflictingResolution.status, 409, 'a different outcome cannot overwrite a saved manual resolution');
    const resolutionState = await pool.query(
      `SELECT status, resolution_outcome FROM meduha_generation_jobs WHERE id = $1`,
      [accepted[0].id],
    );
    assert.equal(resolutionState.rows[0]?.status, 'failed');
    assert.equal(resolutionState.rows[0]?.resolution_outcome, 'failed',
      'the original manual outcome remains authoritative after a conflict');
    const manualLedger = await pool.query(
      `SELECT kind FROM meduha_finance_ledger WHERE reservation_id =
       (SELECT reservation_id FROM meduha_generation_jobs WHERE id = $1)`,
      [accepted[0].id],
    );
    assert.equal(manualLedger.rows.filter(row => row.kind === 'release').length, 1,
      'a replayed manual resolution creates no second finance ledger event');
    const manualAuditCount = await pool.query(
      `SELECT count(*)::int AS count FROM meduha_admin_audit
       WHERE entity_id = $1 AND action = 'generation.manual.resolve'`,
      [accepted[0].id],
    );
    assert.equal(manualAuditCount.rows[0]?.count, 1, 'a replay does not create a second resolution audit event');

    const secondInput = { ...firstInput, idempotencyKey: randomUUID(), prompt: 'A forest in the rain' };
    const secondResponse = await call('/generations', 'POST', secondInput);
    assert.equal(secondResponse.status, 202);
    const completedJob = (await secondResponse.json() as { job: { id: string } }).job;
    const providerRequestId = `req-${randomUUID()}`;
    await runGenerationWorkerOnce({
      submit: async () => ({ status: 'queued', request_id: providerRequestId }),
      getStatus: async () => ({ status: 'queued' }),
    });
    adminProviderStatus = { status: 'completed', video: { url: 'https://media.example.test/seedance.mp4' } };
    let releaseStatusChecks!: () => void;
    adminStatusBarrier = new Promise<void>(resolve => { releaseStatusChecks = resolve; });
    const adminStatusStarted = new Promise<void>(resolve => { signalAdminStatusStarted = resolve; });
    let signalWorkerStatusStarted!: () => void;
    const workerStatusStarted = new Promise<void>(resolve => { signalWorkerStatusStarted = resolve; });
    const checkedProviderPromise = call(`/admin/generations/seedance/${completedJob.id}/check`, 'POST', {});
    await adminStatusStarted;
    const workerCheckPromise = runGenerationWorkerOnce({
      submit: async () => { assert.fail('the in-progress generation must not be submitted again'); },
      getStatus: async requestId => {
        assert.equal(requestId, providerRequestId, 'the worker polls the saved provider request ID');
        signalWorkerStatusStarted();
        await adminStatusBarrier;
        return adminProviderStatus;
      },
      storeVideo: storeVideoForTest,
    });
    await workerStatusStarted;
    releaseStatusChecks();
    const [checkedProvider] = await Promise.all([checkedProviderPromise, workerCheckPromise]);
    adminStatusBarrier = null;
    signalAdminStatusStarted = null;
    assert([200, 409].includes(checkedProvider.status),
      'the admin check either applies its result or reports that the worker already applied it');
    const finished = await (await call('/generations')).json() as { items: Array<{ id: string; status: string; requestId: string | null; resultUrl: string | null }> };
    const completed = finished.items.find(item => item.id === completedJob.id);
    assert.equal(completed?.status, 'completed');
    assert.equal(completed?.requestId, providerRequestId);
    assert.equal(completed?.resultUrl, `/api/meduha/generations/${completedJob.id}/video`);
    await runGenerationWorkerOnce();
    const ledger = await pool.query(
      `SELECT kind FROM meduha_finance_ledger WHERE account_id = $1 AND reservation_id IN
       (SELECT reservation_id FROM meduha_generation_jobs WHERE account_id = $1) ORDER BY kind`,
      [userId],
    );
    assert.equal(ledger.rows.filter(row => row.kind === 'settlement').length, 1, 'completed work settles exactly once');
    assert.equal(ledger.rows.filter(row => row.kind === 'reserve').length, 2, 'two idempotency keys create two holds only');
    assert(videoCopyCalls >= 1, 'the admin status path also saves provider videos before settling them');

    const retryInput = { ...firstInput, idempotencyKey: randomUUID(), prompt: 'A video that needs storage retry' };
    const retryResponse = await call('/generations', 'POST', retryInput);
    assert.equal(retryResponse.status, 202);
    const retryJob = (await retryResponse.json() as { job: { id: string } }).job;
    let retryCopyCalls = 0;
    const retryStoreVideo = async () => {
      retryCopyCalls++;
      if (retryCopyCalls === 1) throw new Error('temporary App Storage error');
      return { size: 24, contentType: 'video/mp4' };
    };
    await runGenerationWorkerOnce({
      submit: async () => ({
        status: 'completed', request_id: `retry-${randomUUID()}`,
        video: { url: 'https://media.example.test/retry.mp4' },
      }),
      getStatus: async () => ({ status: 'queued' }),
      storeVideo: retryStoreVideo,
    });
    const waitingForStorage = await (await call('/generations')).json() as { items: Array<{ id: string; status: string }> };
    assert.equal(waitingForStorage.items.find(item => item.id === retryJob.id)?.status, 'finalizing');
    assert.equal((await getWallet(userId)).reservations.filter(item => item.status === 'held').length, 1,
      'a temporary storage failure keeps the reservation held');
    await runGenerationWorkerOnce({ storeVideo: retryStoreVideo });
    const recoveredFromStorage = await (await call('/generations')).json() as {
      items: Array<{ id: string; status: string; resultUrl: string | null }>;
    };
    const retriedJob = recoveredFromStorage.items.find(item => item.id === retryJob.id);
    assert.equal(retriedJob?.status, 'completed');
    assert.equal(retriedJob?.resultUrl, `/api/meduha/generations/${retryJob.id}/video`);
    assert.equal(retryCopyCalls, 2, 'the provider is not submitted again when storage finalization retries');
    const replayLedger = await pool.query(
      `SELECT kind FROM meduha_finance_ledger WHERE reservation_id =
       (SELECT reservation_id FROM meduha_generation_jobs WHERE id = $1)`,
      [retryJob.id],
    );
    assert.equal(replayLedger.rows.filter(row => row.kind === 'settlement').length, 1,
      'a storage retry creates only one settlement');
    const hiddenVideo = await call(`/generations/${retryJob.id}/video`, 'GET', undefined, `meduha_session=${otherToken}`);
    assert.equal(hiddenVideo.status, 404, 'another account cannot read a private video by guessing its job ID');

    const privatePage = await (await call('/generations', 'GET', undefined, `meduha_session=${otherToken}`)).json() as { items: unknown[] };
    assert.equal(privatePage.items.length, 0, 'jobs are scoped to the authenticated account');

    const recoveryInput = { ...firstInput, idempotencyKey: randomUUID(), prompt: 'A bridge at dawn' };
    const recoveryJobId = randomUUID();
    await pool.query(
      `INSERT INTO meduha_generation_jobs
       (id, account_id, model_id, channel_id, credit_price, idempotency_key, status, input)
       VALUES ($1,$2,$3,$4,20,$5,'awaiting_reservation',$6::jsonb)`,
      [recoveryJobId, userId, modelId, channelId, recoveryInput.idempotencyKey,
        JSON.stringify({ prompt: recoveryInput.prompt, duration: recoveryInput.duration, aspect_ratio: recoveryInput.aspectRatio, resolution: '720p' })],
    );
    await reserveCredits({
      accountId: userId, actorId: userId, amount: 20, modelId,
      reason: `Seedance 2.5 · ${recoveryInput.duration}s`,
      idempotencyKey: `generation-reserve:${userId}:${recoveryInput.idempotencyKey}`,
    });
    await pool.query('UPDATE meduha_ai_channels SET enabled = false WHERE id = $1', [channelId]);
    await pool.query('UPDATE meduha_ai_models SET enabled = false WHERE id = $1', [modelId]);
    const recoveredResponse = await call('/generations', 'POST', recoveryInput);
    assert.equal(recoveredResponse.status, 202, 'an existing hold can resume after model settings change');
    const recovered = (await recoveredResponse.json() as { job: { id: string; status: string; creditPrice: number } }).job;
    assert.equal(recovered.id, recoveryJobId);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.creditPrice, 20, 'replay preserves the original reserved price');
    const recoveredWallet = await getWallet(userId);
    assert.equal(recoveredWallet.reservations.filter(item => item.status === 'held').length, 1,
      'only the recovered job remains held after the earlier uncertain hold is manually released');
  } finally {
    const { rows } = await pool.query(
      `SELECT id FROM meduha_credit_reservations WHERE account_id = ANY($1::text[])`,
      [[userId, otherUserId]],
    );
    const reservationIds = rows.map(row => row.id);
    await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id IN (SELECT id FROM meduha_generation_jobs WHERE account_id = ANY($1::text[]))', [[userId, otherUserId]]);
    await pool.query('DELETE FROM meduha_generation_jobs WHERE account_id = ANY($1::text[])', [[userId, otherUserId]]);
    if (reservationIds.length) {
      await pool.query('DELETE FROM meduha_finance_idempotency WHERE reservation_id = ANY($1::text[])', [reservationIds]);
    }
    await pool.query('DELETE FROM meduha_finance_ledger WHERE account_id = ANY($1::text[])', [[userId, otherUserId]]);
    await pool.query('DELETE FROM meduha_credit_reservations WHERE account_id = ANY($1::text[])', [[userId, otherUserId]]);
    await pool.query('DELETE FROM meduha_accounts WHERE id = ANY($1::text[])', [[userId, otherUserId]]);
    await pool.query('DELETE FROM meduha_ai_models WHERE id = $1', [modelId]);
    await pool.query('DELETE FROM meduha_ai_channels WHERE id = $1', [channelId]);
    await updateFinanceSettings({
      spendingEnabled: previousSettings.spendingEnabled,
      dailyCreditLimit: previousSettings.dailyCreditLimit,
      maxActiveReservations: previousSettings.maxActiveReservations,
    }, 'generation-test-cleanup');
  }
});
}
