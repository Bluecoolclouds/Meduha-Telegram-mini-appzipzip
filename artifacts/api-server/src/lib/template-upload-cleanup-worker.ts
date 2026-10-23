import { logger } from './logger';
import {
  cleanupAbandonedTemplateUploads,
  TEMPLATE_UPLOAD_CLEANUP_INTERVAL_MS,
} from './template-upload-cleanup';

export function startTemplateUploadCleanupWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const removed = await cleanupAbandonedTemplateUploads();
      if (removed) logger.info({ removed }, 'Removed abandoned template uploads');
    } catch (err) {
      logger.warn({ err }, 'Abandoned template upload cleanup failed');
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(() => void run(), TEMPLATE_UPLOAD_CLEANUP_INTERVAL_MS);
  return () => clearInterval(interval);
}
