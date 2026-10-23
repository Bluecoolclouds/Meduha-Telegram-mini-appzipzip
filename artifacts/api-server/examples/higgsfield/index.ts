import { completedVideo, higgsfieldClient, SEEDANCE_MODEL } from '../../src/lib/higgsfield';

// ONE billable request. Do not automatically rerun after a timeout or network failure.
try {
  const result = await higgsfieldClient().subscribe(SEEDANCE_MODEL, {
    input: {
      prompt: 'A cinematic scene at sunset',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    },
    withPolling: true,
  });
  if (result.status !== 'completed') {
    const status = String(result.status);
    const known = ['failed', 'nsfw', 'moderated', 'canceled', 'cancelled', 'queued', 'in_progress'];
    console.error(`Generation ended without success: ${known.includes(status) ? status : 'unexpected status'}`);
    process.exitCode = 1;
  } else {
    console.log(completedVideo(result));
  }
} catch (error) {
  // SDK/HTTP errors can contain Authorization headers. Never dump the error object.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const safeNames = ['AuthenticationError', 'NotEnoughCreditsError', 'ValidationError', 'BadInputError', 'APIError'];
  console.error(`Higgsfield generation failed (${safeNames.includes(name) ? name : 'request or configuration error'}). No video verified. Do not retry blindly.`);
  process.exitCode = 1;
}
