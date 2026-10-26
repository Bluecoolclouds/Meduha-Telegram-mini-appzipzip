import app from "./app";
import { logger } from "./lib/logger";
import { startTelegramWorker } from './lib/telegram-worker';
import { startTemplateUploadCleanupWorker } from './lib/template-upload-cleanup-worker';
import { startMeduhaAdminCleanupWorker } from './lib/meduha-admin-cleanup-worker';
import { startGenerationWorker } from './lib/generation-worker';
import { startPaymentCreditWorker } from './lib/payment-credit-worker';
import { pool } from '@workspace/db';
import { registerPhotoModels } from './routes/meduha-photo';
import { registerVideoModels } from './routes/meduha-video';

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await registerPhotoModels();
await registerVideoModels();
const server=app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
const stopTelegram=startTelegramWorker();
const stopTemplateUploadCleanup=startTemplateUploadCleanupWorker();
const stopMeduhaAdminCleanup=startMeduhaAdminCleanupWorker(logger);
const stopGenerationWorker=startGenerationWorker();
const stopPaymentCreditWorker=startPaymentCreditWorker();
function shutdown(){
  stopTelegram();
  stopTemplateUploadCleanup();
  stopMeduhaAdminCleanup();
  stopGenerationWorker();
  stopPaymentCreditWorker();
  server.close(()=>{void pool.end().finally(()=>process.exit(0));});
  setTimeout(()=>process.exit(0),5000).unref();
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
