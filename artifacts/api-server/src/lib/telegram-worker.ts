import { setTimeout as delay } from 'node:timers/promises';
import { createTelegramApi, TelegramApiError } from './telegram-api';
import { createTelegramCommandHandler, pendingCommands, type TelegramUpdate } from './telegram-commands';
import { logger } from './logger';
import { initializeTemplateAdmin } from './template-admin';

/** Development polling needs no public URL. Production uses the webhook route. */
export function startTelegramWorker() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const transport = process.env.TELEGRAM_BOT_TRANSPORT ?? (process.env.NODE_ENV === 'production' ? 'webhook' : 'polling');
  if (!token || transport !== 'polling') {
    logger.info({ transport, configured: !!token }, 'Telegram bot: polling not started');
    return () => {};
  }
  const controller = new AbortController();
  const api = createTelegramApi(token);
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const webhook = await api('getWebhookInfo', {}, controller.signal) as { url?: string };
        if (webhook.url) {
          logger.warn('Telegram webhook already configured; polling will not replace it');
          return;
        }
        const bot = await api('getMe', {}, controller.signal) as { username?: string };
        if (!bot.username) throw new TelegramApiError(401);
        const handle = createTelegramCommandHandler(api, bot.username, initializeTemplateAdmin);
        logger.info('Telegram bot: receiving messages via long polling');
        let offset: number | undefined;
        while (!controller.signal.aborted) {
          const result = await api('getUpdates', {
            ...(offset === undefined ? {} : { offset }),
            timeout: 25, limit: 100, allowed_updates: ['message'],
          }, controller.signal);
          if (!Array.isArray(result)) throw new TelegramApiError(502);
          const updates = (result as TelegramUpdate[]).filter(update => Number.isSafeInteger(update.update_id));
          for (const update of pendingCommands(updates)) await handle(update);
          // Acknowledge only after successful processing. Telegram retries failures.
          if (updates.length) offset = Math.max(...updates.map(update => update.update_id)) + 1;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const status = error instanceof TelegramApiError ? error.status : 0;
        if (status === 401 || status === 409) {
          logger.error({ status }, 'Telegram polling stopped: credential invalid or another receiver is active');
          return;
        }
        logger.warn({ status }, 'Telegram polling interrupted; retrying');
        const seconds = error instanceof TelegramApiError ? Math.max(1, Math.min(error.retryAfter, 60)) : 5;
        await delay(seconds * 1000, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  })();
  return () => controller.abort();
}
