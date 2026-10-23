import { Router } from 'express';
import { Readable } from 'node:stream';

const router = Router();
// Public, attributed sample media only. Never accept an arbitrary upstream URL
// or expose the private user-upload storage through this route.
const sources: Record<string, string> = {
  'flower.webm': 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
  'sintel.webm': 'https://media.w3.org/2010/05/sintel/trailer.webm',
  'sintel.png': 'https://media.w3.org/2010/05/sintel/poster.png',
};

router.get('/:name', async (req, res): Promise<void> => {
  const source = Object.hasOwn(sources, req.params.name) ? sources[req.params.name] : undefined;
  if (!source) { res.sendStatus(404); return; }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const upstream = await fetch(source, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: req.headers.range ? { Range: req.headers.range } : undefined,
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
