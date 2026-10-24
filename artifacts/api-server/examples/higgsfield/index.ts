import { setTimeout as delay } from 'node:timers/promises';
import { completedVideo, getHiggsfieldRequestStatus, submitHiggsfieldGeneration, SEEDANCE_MODEL } from '../../src/lib/higgsfield';

// ONE billable request. Do not automatically rerun after a timeout or network failure.
try {
  const submitted = await submitHiggsfieldGeneration(SEEDANCE_MODEL, {
      prompt: 'A cinematic scene at sunset',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
  });
  if (!submitted.request_id) throw new Error('Provider did not confirm a request ID; do not retry.');
  let result = submitted;
  const deadline = Date.now() + 10 * 60_000;
  while (!['completed', 'failed', 'nsfw', 'canceled'].includes(result.status) && Date.now() < deadline) {
    await delay(5000);
    result = { ...await getHiggsfieldRequestStatus(submitted.request_id), request_id: submitted.request_id };
  }
  if (result.status !== 'completed') {
    const status = String(result.status);
    const known = ['failed', 'nsfw', 'moderated', 'canceled', 'cancelled', 'queued', 'in_progress'];
    console.error(`Generation ended without success: ${known.includes(status) ? status : 'unexpected status'}`);
    process.exitCode = 1;
  } else {
    console.log(completedVideo({ status: result.status, video: result.video?.url ? { url: result.video.url } : undefined }));
  }
} catch (error) {
  // SDK/HTTP errors can contain Authorization headers. Never dump the error object.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const safeNames = ['AuthenticationError', 'NotEnoughCreditsError', 'ValidationError', 'BadInputError', 'APIError'];
  console.error(`Higgsfield generation failed (${safeNames.includes(name) ? name : 'request or configuration error'}). No video verified. Do not retry blindly.`);
  process.exitCode = 1;
}
