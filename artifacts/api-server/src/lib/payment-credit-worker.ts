import { logger } from './logger';
import { grantNextDueInstallment } from './billing-orders';

export function startPaymentCreditWorker(intervalMs = 30_000) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Drain a bounded batch. SKIP LOCKED lets multiple API replicas share work.
      for (let count = 0; count < 100 && !stopped; count++) {
        if (!await grantNextDueInstallment()) break;
      }
    } catch (error) {
      logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Scheduled payment credit grant failed');
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
