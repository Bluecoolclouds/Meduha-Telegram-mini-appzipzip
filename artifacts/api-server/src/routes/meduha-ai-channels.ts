import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, meduhaAiChannels } from '@workspace/db';
import { AiChannelError, discoverChannel, importChannelModels } from '../lib/ai-channels';

export function createAiChannelRouter(requiredAdmin: (req: Request, res: Response) => Promise<string | null>) {
  const router = Router();
  router.use(async (req, res, next) => {
    const actor = await requiredAdmin(req, res);
    if (!actor) return;
    res.locals.aiChannelActor = actor;
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/channels/:channelId/discover', async (req, res) => {
    const [channel] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.id, req.params.channelId));
    if (!channel) { res.status(404).json({ error: 'Канал не найден.' }); return; }
    try {
      const models = await discoverChannel(channel);
      res.set('Cache-Control', 'no-store').json({
        checkedAt: new Date().toISOString(), models,
        notice: 'Ключ и каталог доступны. Генерация, полная схема параметров и расходы этим тестом не проверены. Платных запросов не было.',
      });
    } catch (error) {
      res.status(error instanceof AiChannelError ? error.status : 502).json({ error: error instanceof AiChannelError ? error.message : 'Не удалось проверить канал. Секреты не выводятся.' });
    }
  });
  router.post('/channels/:channelId/import', async (req, res) => {
    const [channel] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.id, req.params.channelId));
    if (!channel) { res.status(404).json({ error: 'Канал не найден.' }); return; }
    const ids = req.body?.modelIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || id.length > 200) || new Set(ids).size !== ids.length) {
      res.status(400).json({ error: 'Выбери от 1 до 50 разных моделей.' }); return;
    }
    try { res.status(201).json({ imported: await importChannelModels(channel, ids, res.locals.aiChannelActor) }); }
    catch (error) { res.status(error instanceof AiChannelError ? error.status : 502).json({ error: error instanceof AiChannelError ? error.message : 'Импорт не завершён. Уже импортированные модели сохранены.' }); }
  });
  return router;
}
