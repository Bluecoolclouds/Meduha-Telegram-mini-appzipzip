import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db, meduhaTemplates } from '@workspace/db';
import { motionAssets, motionExample } from '../lib/motion-example';
import { createFeedVariant, variantFile, type FeedSource, type FeedVariant } from '../lib/feed-media';

const cdn = 'https://media.w3.org/2010/05/sintel/';
const examplePhotos: Record<string, string> = {
  'example-space': 'astronaut', 'example-flower-film': 'flower',
  'example-portrait': 'portrait', 'example-car': 'car', 'example-city': 'city',
  'example-mountain': 'mountain', 'example-perfume': 'perfume',
};
const localKeys = new Map<string, { stamp: string; key: string }>();
async function localImage(relative: string): Promise<FeedSource | null> {
  // Only stored image paths, never request-supplied filesystem paths.
  if (!/^images\/[a-z0-9/_-]+\.(png|jpe?g|webp)$/.test(relative)) return null;
  const roots = [path.resolve(process.cwd(), '../meduha/public'), path.resolve(process.cwd(), 'artifacts/meduha/public')];
  const localPath = roots.map(root => path.join(root, relative)).find(existsSync);
  if (!localPath) return null;
  const info = await stat(localPath);
  if (info.size > 10 * 1024 * 1024) return null;
  const stamp = `${info.size}:${info.mtimeMs}`;
  let cached = localKeys.get(localPath);
  if (cached?.stamp !== stamp) {
    cached = { stamp, key: `local:${createHash('sha256').update(await readFile(localPath)).digest('hex')}` };
    localKeys.set(localPath, cached);
  }
  return { key: cached.key, localPath };
}
type PublishedMedia = { poster: string; video: string | null; kind: string };
async function findPublishedTemplate(id: string): Promise<PublishedMedia | undefined> {
  const [template] = await db.select({ poster: meduhaTemplates.poster, video: meduhaTemplates.videoUrl, kind: meduhaTemplates.kind })
    .from(meduhaTemplates).where(and(eq(meduhaTemplates.id, id), eq(meduhaTemplates.status, 'published'))).limit(1);
  return template;
}
type Dependencies = {
  findPublished?: typeof findPublishedTemplate;
  prepare?: typeof createFeedVariant;
  file?: typeof variantFile;
};
async function sourceFor(id: string, variant: FeedVariant, findPublished = findPublishedTemplate): Promise<FeedSource | null> {
  if (id === motionExample.id) {
    const objectId = motionAssets[variant === 'thumb' ? 'motion-poster.jpg' : 'motion-result.mp4'].id;
    return { key: objectId, objectId };
  }
  if (id === 'example-fantasy-film') {
    const url = `${cdn}${variant === 'thumb' ? 'poster.png' : 'trailer.webm'}`;
    return { key: url, url, ...(variant === 'preview' ? { start: 5 } : {}) };
  }
  if (id === 'example-flower-film' && variant === 'preview') {
    const url = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm';
    return { key: url, url };
  }
  if (examplePhotos[id]) return variant === 'thumb' ? localImage(`images/meduha/${examplePhotos[id]}.png`) : null;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  // Check publication before every response, including cached derivatives and
  // conditional requests. A private or revoked work must never leak its preview.
  const template = await findPublished(id);
  const raw = variant === 'thumb' ? template?.poster : template?.kind === 'video' ? template.video : null;
  if (!raw) return null;
  const match = /^\/api\/meduha\/media\/([a-f0-9-]{36})$/i.exec(raw);
  if (match) return { key: match[1], objectId: match[1] };
  if (raw.startsWith('https://')) return { key: raw, url: raw };
  return variant === 'thumb' ? localImage(raw) : null;
}

export function byteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: size - 1 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return null;
  if ([m[1], m[2]].some(n => n && !Number.isSafeInteger(Number(n)))) return null;
  const suffix = !m[1];
  if (suffix && (!Number.isSafeInteger(Number(m[2])) || Number(m[2]) <= 0)) return null;
  const start = suffix ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = suffix || !m[2] ? size - 1 : Math.min(Number(m[2]), size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

async function serve(req: Request, res: Response, dependencies: Dependencies) {
  const variant = req.params.variant;
  if (variant !== 'thumb' && variant !== 'preview') { res.sendStatus(404); return; }
  const source = await sourceFor(String(req.params.id), variant, dependencies.findPublished);
  if (!source) { res.set('Cache-Control', 'no-store').sendStatus(404); return; }
  try {
    await (dependencies.prepare ?? createFeedVariant)(source, variant);
    if (res.destroyed) return;
    // Preparation can take time: do not serve a cached derivative if the owner
    // revoked publication or replaced the media while this request was queued.
    const current = await sourceFor(String(req.params.id), variant, dependencies.findPublished);
    if (!current || current.key !== source.key || current.start !== source.start) {
      res.set('Cache-Control', 'no-store').sendStatus(404); return;
    }
    const file = (dependencies.file ?? variantFile)(source, variant);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024) throw new Error('Invalid cached preview size');
    const etag = `"feed-${metadata.generation}"`;
    res.set({ 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' });
    if (!req.headers.range && req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    const requestedRange = req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)
      ? req.headers.range : undefined;
    const range = byteRange(requestedRange, size);
    if (!range) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
    if (requestedRange) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.set({ 'Content-Type': variant === 'thumb' ? 'image/webp' : 'video/mp4', 'Content-Length': String(range.end - range.start + 1) });
    if (req.method === 'HEAD') { res.end(); return; }
    // Derivatives are capped at 1 MB. Finish this bounded SDK read even if the
    // browser leaves; destroying a not-yet-initialized GCS stream can throw
    // outside the stream's error handler in the installed Storage SDK.
    const [contents] = await file.download(range);
    if (!res.destroyed) res.end(contents);
  } catch (error) {
    req.log.warn({ variant, errorName: error instanceof Error ? error.name : 'UnknownError',
      code: (error as { code?: string | number })?.code,
      encoderMessage: (error as { stderr?: string })?.stderr?.slice(-1000),
    }, 'Feed preview unavailable');
    if (!res.headersSent && !res.destroyed) res.status(503).set({ 'Cache-Control': 'no-store', 'Retry-After': '60' }).json({ error: 'Не удалось подготовить превью. Оригинал доступен при открытии работы.' });
  }
}
export function createFeedMediaRouter(dependencies: Dependencies = {}) {
  const router = Router();
  router.get('/feed-media/:id/:variant', (req, res) => serve(req, res, dependencies));
  return router;
}
export default createFeedMediaRouter();
