import express, { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import {
  CONTENT_MEDIA_ID, MAX_CONTENT_IMAGE, listStudioContent, parseStudioContent,
  saveStudioContent, studioContentFile, validateStudioImage,
} from '../lib/studio-content';

const param = (req: Request, key: string) => {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

export function createStudioContentAdminRouter(requireAdmin: (req: Request, res: Response) => Promise<string | null>) {
  const router = Router();
  router.use(async (req, res, next): Promise<void> => {
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    res.locals.studioContentActor = actor;
    res.setHeader('Cache-Control','no-store');
    next();
  });
  router.get('/studio-content', async (_req,res): Promise<void> => {
    res.json(await listStudioContent());
  });
  router.put('/studio-content/:contentKey', async (req,res): Promise<void> => {
    const key = param(req, 'contentKey');
    const data = parseStudioContent(key, req.body);
    if (!data) {
      res.status(400).json({code:'INVALID_INPUT',error:'Проверь название, описание и ссылку на общедоступную обложку.'});
      return;
    }
    const result = await saveStudioContent(key,data,res.locals.studioContentActor);
    if (result.status !== 200) {
      res.status(result.status).json({code:result.code,error: result.status === 409
        ? 'Запись уже изменена. Обнови данные перед сохранением.' : 'Загруженное изображение не найдено.'});
      return;
    }
    res.json(result.item);
  });
  router.post('/studio-content-media', express.raw({type:'application/octet-stream',limit:MAX_CONTENT_IMAGE}), async (req,res): Promise<void> => {
    const type = req.get('X-Media-Type') ?? '';
    if (!Buffer.isBuffer(req.body) || !validateStudioImage(type,req.body)) {
      res.status(400).json({code:'INVALID_IMAGE',error:'Нужен JPEG, PNG или WebP до 2 МБ.'});
      return;
    }
    if (!process.env.PRIVATE_OBJECT_DIR) {
      res.status(503).json({code:'STORAGE_UNAVAILABLE',error:'Хранилище изображений не настроено.'});
      return;
    }
    const id = randomUUID(), file = studioContentFile(id);
    await file.save(req.body,{resumable:false,metadata:{contentType:type,cacheControl:'public, max-age=3600'},preconditionOpts:{ifGenerationMatch:0}});
    try {
      await pool.query('INSERT INTO meduha_studio_content_media(id,content_type,size) VALUES($1,$2,$3)',[id,type,req.body.length]);
    } catch(error) { await file.delete().catch(() => {}); throw error; }
    res.status(201).json({url:`/api/meduha/studio-content-media/${id}`});
  });
  return router;
}

export function createStudioContentPublicRouter() {
  const router = Router();
  router.get('/studio-content', async (_req,res): Promise<void> => {
    res.setHeader('Cache-Control','no-store');
    res.json(await listStudioContent());
  });
  router.get('/studio-content-media/:mediaId', async (req,res): Promise<void> => {
    const id = param(req,'mediaId');
    if (!CONTENT_MEDIA_ID.test(id)) { res.sendStatus(404); return; }
    const {rows:[media]} = await pool.query('SELECT content_type,size FROM meduha_studio_content_media WHERE id=$1',[id]);
    if (!media) { res.sendStatus(404); return; }
    // These are explicit administrator uploads for public curated examples,
    // never user generation paths. Bounded downloads avoid GCS stream races.
    const [bytes] = await studioContentFile(id).download();
    if (bytes.length !== media.size || bytes.length > MAX_CONTENT_IMAGE) { res.sendStatus(502); return; }
    res.setHeader('Content-Type',media.content_type);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','public, max-age=3600');
    res.send(bytes);
  });
  return router;
}
