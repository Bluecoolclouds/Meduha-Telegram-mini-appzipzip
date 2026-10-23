import type { logger as applicationLogger } from './logger';
import {
  cleanupExpiredMeduhaAdminAccess,
  ADMIN_ACCESS_CLEANUP_INTERVAL_MS,
} from './meduha-admin-cleanup';

type CleanupLogger = Pick<typeof applicationLogger, 'info' | 'warn'>;

export async function runMeduhaAdminCleanupSafely(
  cleanup: typeof cleanupExpiredMeduhaAdminAccess = cleanupExpiredMeduhaAdminAccess,
  onError: (err: unknown) => void = () => {},
) {
  try {
    return await cleanup();
  } catch (err) {
    // Cleanup and its reporting are best-effort, never blocking login.
    try { onError(err); } catch { /* Logging failures must not escape into request handling. */ }
    return undefined;
  }
}

export function startMeduhaAdminCleanupWorker(logger: CleanupLogger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runMeduhaAdminCleanupSafely(cleanupExpiredMeduhaAdminAccess, err => {
        try { logger.warn({ err }, 'Administrator access cleanup failed'); } catch {}
      });
      if (result?.acquired && (result.pairingsRemoved || result.sessionsRemoved)) {
        try { logger.info(result, 'Removed expired administrator access records'); } catch {}
      }
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(() => void run(), ADMIN_ACCESS_CLEANUP_INTERVAL_MS);
  return () => clearInterval(interval);
}
