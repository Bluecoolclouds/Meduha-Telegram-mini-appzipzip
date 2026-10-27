import express, { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { CreateAdminBroadcastBody, ActionAdminBroadcastBody, ListAdminBroadcastsResponse, CreateAdminBroadcastResponse } from '@workspace/api-zod';
import { parseBroadcast } from '../lib/broadcast-content';
import { broadcastFile, checkBroadcastMedia } from '../lib/broadcast-storage';
import { broadcastAudit, broadcastView, eligibleContactSql, eligibleCount, listBroadcasts, saveBroadcast, sendBroadcastMessage } from '../lib/broadcasts';
import { TelegramApiError } from '../lib/telegram-api';

export function createBroadcastRouter(requireAdmin: (req: Request, res: Response) => Promise<string | null>, send = sendBroadcastMessage) {
  const router = Router();
  router.use(async (req, res, next): Promise<void> => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    res.locals.broadcastActor = actor;
    res.setHeader('Cache-Control','no-store');
    next();
  });
  router.get('/broadcasts', async (_req, res): Promise<void> => {
    res.json(ListAdminBroadcastsResponse.parse({ items: await listBroadcasts(), eligible: await eligibleCount(), botConfigured: !!process.env.TELEGRAM_BOT_TOKEN }));
  });
  router.post('/broadcast-media', express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res): Promise<void> => {
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'Нужен файл.' }); return; }
    let kind: 'photo' | 'video';
    const type = req.get('X-Media-Type') ?? '';
    try { kind = checkBroadcastMedia(type, req.body); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
    const id = randomUUID(), file = broadcastFile(id);
    await file.save(req.body, { resumable: false, metadata: { contentType: type, cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: 0 } });
    try { await pool.query('INSERT INTO meduha_broadcast_media(id,kind,content_type,size) VALUES($1,$2,$3,$4)', [id,kind,type,req.body.length]); }
    catch (e) { await file.delete().catch(() => {}); throw e; }
    res.status(201).json({ id, kind });
  });
  router.post('/broadcasts', async (req, res): Promise<void> => {
    const parsed = CreateAdminBroadcastBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Проверь поля поста.' }); return; }
    let content;
    try { content = parseBroadcast(parsed.data); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
    if (content.mediaId && !(await pool.query('SELECT id FROM meduha_broadcast_media WHERE id=$1', [content.mediaId])).rowCount) { res.status(400).json({error:'Медиа не найдено.'}); return; }
    const campaign = await saveBroadcast(res.locals.broadcastActor, content);
    res.status(201).json(CreateAdminBroadcastResponse.parse(campaign));
  });
  router.post('/broadcasts/:id/:action', async (req, res): Promise<void> => {
    const id = String(req.params.id), action = String(req.params.action);
    const input = ActionAdminBroadcastBody.safeParse(req.body);
    if (!/^[a-f0-9-]{36}$/.test(id) || !['test','send','cancel'].includes(action) || !input.success) { res.status(400).json({ error: 'Неверный запрос.' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A worker and all administrative actions share this lock. Cancel cannot race a new send.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('meduha-broadcast'))");
      const { rows: [b] } = await client.query(`SELECT b.*,m.kind media_kind FROM meduha_broadcasts b LEFT JOIN meduha_broadcast_media m ON m.id=b.media_id WHERE b.id=$1 FOR UPDATE OF b`, [id]);
      if (!b) { await client.query('ROLLBACK'); res.status(404).json({ error:'Пост не найден.' }); return; }
      if (action === 'test') {
        if (b.status !== 'draft' || !input.data.chatId) { await client.query('ROLLBACK'); res.status(409).json({ error:'Тест доступен для черновика. Укажи свой Telegram ID.' }); return; }
        if (!process.env.TELEGRAM_BOT_TOKEN) { await client.query('ROLLBACK'); res.status(503).json({error:'Telegram-бот не настроен.'}); return; }
        const contact = await client.query('SELECT id FROM meduha_bot_contacts WHERE id=$1 AND reachable=true', [input.data.chatId]);
        if (!contact.rowCount) { await client.query('ROLLBACK'); res.status(400).json({error:'Сначала напиши боту /start с этого аккаунта.'}); return; }
        await send(b, input.data.chatId);
        await client.query('UPDATE meduha_broadcasts SET tested_at=now() WHERE id=$1', [id]);
      } else if (action === 'send') {
        if (input.data.confirm !== id || !b.tested_at) { await client.query('ROLLBACK'); res.status(409).json({error:'Нужны успешный тест и подтверждение отправки.'}); return; }
        if (!process.env.TELEGRAM_BOT_TOKEN) { await client.query('ROLLBACK'); res.status(503).json({error:'Telegram-бот не настроен.'}); return; }
        if (b.status === 'draft') {
          const queued = await client.query(`INSERT INTO meduha_broadcast_deliveries(id,campaign_id,contact_id)
            SELECT $1 || ':' || c.id,$1,c.id FROM meduha_bot_contacts c LEFT JOIN meduha_accounts a ON a.id=c.id
            WHERE ${eligibleContactSql} ON CONFLICT DO NOTHING`, [id]);
          if (!queued.rowCount) { await client.query('ROLLBACK'); res.status(409).json({error:'Нет подписавшихся получателей.'}); return; }
          await client.query("UPDATE meduha_broadcasts SET status='queued' WHERE id=$1", [id]);
        } else if (!['queued','completed'].includes(b.status)) { await client.query('ROLLBACK'); res.status(409).json({error:'Рассылка остановлена.'}); return; }
      } else {
        if (['draft','queued'].includes(b.status)) {
          await client.query("UPDATE meduha_broadcasts SET status='canceled' WHERE id=$1", [id]);
          await client.query("UPDATE meduha_broadcast_deliveries SET status='canceled' WHERE campaign_id=$1 AND status='pending'", [id]);
        }
      }
      await broadcastAudit(client, res.locals.broadcastActor, `broadcast.${action}`, id);
      await client.query('COMMIT');
      const current = (await listBroadcasts()).find(x => x.id === id);
      res.json(current ?? broadcastView(b));
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof TelegramApiError) { res.status(e.status >= 400 && e.status < 500 ? 400 : 503).json({error: e.status === 429 ? `Лимит Telegram. Повтори через ${e.retryAfter} с.` : 'Тест не подтверждён Telegram. Проверь доступность чата и медиа перед повтором.'}); return; }
      req.log.error({ code:'BROADCAST_ACTION_FAILED' }, 'Broadcast action failed');
      res.status(503).json({error:'Не удалось выполнить действие. Обнови список перед повтором.'});
    } finally { client.release(); }
  });
  return router;
}
