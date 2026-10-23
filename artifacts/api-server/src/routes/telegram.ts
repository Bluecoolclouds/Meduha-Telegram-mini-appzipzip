import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createTelegramApi } from '../lib/telegram-api';
import { createTelegramCommandHandler, type TelegramUpdate } from '../lib/telegram-commands';
import { resolveTelegramBotUsername } from '../lib/telegram-bot';
import { TelegramWebhookBody } from '@workspace/api-zod';
import { initializeTemplateAdmin } from '../lib/template-admin';

export const webhookSecretFor = (token: string) => createHmac('sha256', token).update('meduha/telegram-webhook/v1').digest('hex');
const router = Router();
// Dedupe Telegram's retries within this process; retain no message/profile contents.
const completed = new Map<number, number>();
const pending = new Map<number, Promise<void>>();
router.post('/webhook', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { res.sendStatus(503); return; }
  const provided = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const expected = webhookSecretFor(token);
  if (!/^[a-f0-9]{64}$/.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    res.sendStatus(403); return;
  }
  const parsed = TelegramWebhookBody.safeParse(req.body);
  if (!parsed.success) { res.sendStatus(400); return; }
  const update: TelegramUpdate = parsed.data;
  const now = Date.now();
  for (const [id, at] of completed) if (now - at > 86_400_000) completed.delete(id);
  if (completed.has(update.update_id)) { res.status(200).end(); return; }
  let task = pending.get(update.update_id);
  if (!task) {
    task = (async () => {
      const username = await resolveTelegramBotUsername(token);
      if (!username) throw new Error('Telegram metadata unavailable');
      await createTelegramCommandHandler(createTelegramApi(token), username, initializeTemplateAdmin)(update);
      completed.set(update.update_id, Date.now());
      if (completed.size > 2000) completed.delete(completed.keys().next().value!);
    })();
    pending.set(update.update_id, task);
  }
  try { await task; res.status(200).end(); }
  catch { res.sendStatus(503); }
  finally { if (pending.get(update.update_id) === task) pending.delete(update.update_id); }
});
export default router;
