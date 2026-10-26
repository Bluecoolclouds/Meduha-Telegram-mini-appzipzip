import { Router } from 'express';
import { Readable } from 'node:stream';
import { motionAssets } from '../lib/motion-example';
import { templateFile } from '../lib/objectStorage';
import { catalogCoverAsset } from '../lib/catalog-covers';

const router = Router();
// Public, attributed sample media only. Never accept an arbitrary upstream URL
// or expose the private user-upload storage through this route.
const sources: Record<string, string> = {
  'flower.webm': 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
  'sintel.webm': 'https://media.w3.org/2010/05/sintel/trailer.webm',
  'sintel.png': 'https://media.w3.org/2010/05/sintel/poster.png',
};

router.get('/:name', async (req, res): Promise<void> => {
  const cover = catalogCoverAsset(req.params.name);
  const asset = Object.hasOwn(motionAssets, req.params.name)
    ? motionAssets[req.params.name as keyof typeof motionAssets]
    : cover;
  if (asset) {
    try {
      const file = templateFile(asset.id);
      // Home assets are curated, fixed object IDs with verified manifest sizes.
      // Avoid a storage metadata round trip before every HEAD/range/image request.
      // Legacy examples still use their actual metadata (including test fixtures).
      const size = cover?.size ?? (req.params.name.startsWith('home-')
        ? asset.size : Number((await file.getMetadata())[0].size));
      res.set({
        ETag: cover ? `"${req.params.name}"` : `"${asset.id}-${size}"`,
        'Cache-Control': cover ? 'public,max-age=31536000,immutable' : 'public,max-age=3600',
      });
      if (req.fresh) { res.status(304).end(); return; }
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
        if (!match[1]) start = Math.max(0, size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
          res.status(416).set('Content-Range', `bytes */${size}`).end(); return;
        }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      res.set({ 'Content-Type': asset.contentType, 'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes', 'Cache-Control': cover ? 'public,max-age=31536000,immutable' : 'public,max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      file.createReadStream({ start, end }).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.status(503).json({ error: 'Материалы примера временно недоступны.' }); }
    return;
  }
  const source = Object.hasOwn(sources, req.params.name) ? sources[req.params.name] : undefined;
  if (!source) { res.sendStatus(404); return; }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const upstream = await fetch(source, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: req.headers.range ? { Range: req.headers.range } : undefined,
      redirect: 'manual',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    });
    if (!upstream.ok && upstream.status !== 416) {
      await upstream.body?.cancel();
      res.status(502).json({ error: 'Пример временно недоступен.' });
      return;
    }
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD' || !upstream.body) { res.end(); return; }
    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on('error', err => { if (!controller.signal.aborted) req.log.warn({ err }, 'Example media stream failed'); res.destroy(); });
    stream.pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    req.log.warn({ err }, 'Example media unavailable');
    if (!res.headersSent) res.status(502).json({ error: 'Пример временно недоступен.' });
    else res.destroy();
  }
});

export default router;
