import { createHmac, createHash, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';

const sessionHash = (value: string) => createHash('sha256').update(value).digest('hex');
const VIDEO_MODEL = 'higgsfield/genjutsu/motion-transfer/v1.0';

function signedInitData(botToken: string, accountId: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(accountId), first_name: 'Recipe browser fixture' }),
  });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  fields.set('hash', createHmac('sha256', secret)
    .update([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n'))
    .digest('hex'));
  return fields.toString();
}

async function createUnusedAccountId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(4_503_599_003_000_000 + randomInt(1_000_000));
    const existing = await pool.query('SELECT 1 FROM meduha_accounts WHERE id = $1 LIMIT 1', [candidate]);
    if (existing.rowCount === 0) return candidate;
  }
  throw new Error('Could not allocate an unused recipe fixture account ID.');
}

export async function startTemplateRepeatBrowserFixture() {
  const accountId = await createUnusedAccountId();
  const botToken = `${randomInt(1_000_000_000, 2_000_000_000)}:template-repeat-browser-test-only`;
  const sourceId = randomUUID();
  const sourceVideoId = randomUUID();
  const sourceImageId = randomUUID();
  const copies = new Map<string, any>();
  let fixtureStopped = false;

  const recipe = {
    version: 1 as const,
    kind: 'video' as const,
    catalogId: VIDEO_MODEL,
    parameters: { prompt: 'Опубликованный промпт движения', resolution: '1080p' },
    references: { '/video_url': [sourceVideoId], '/image_urls': [sourceImageId] },
  };
  const file = (id: string, contentType: string) => ({
    id, url: `/api/meduha/media/${id}`, contentType, size: 1024,
  });
  const source = {
    id: sourceId,
    title: 'Опубликованный пример переноса движения',
    sourceTemplateId: sourceId,
    recipe,
    files: {
      '/video_url': [file(sourceVideoId, 'video/mp4')],
      '/image_urls': [file(sourceImageId, 'image/webp')],
    },
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/meduha', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Meduha-Request') !== '1') {
      res.status(403).json({ code: 'REQUEST_ORIGIN_REQUIRED', error: 'Meduha request header is required.' });
      return;
    }
    next();
  });

  async function hasVerifiedFixtureSession(req: Request) {
    const raw = req.cookies?.meduha_session;
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return false;
    const result = await pool.query(
      'SELECT 1 FROM meduha_sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()',
      [sessionHash(raw), accountId],
    );
    return result.rowCount === 1;
  }

  app.use('/api/meduha', async (req: Request, res: Response, next) => {
    if (req.method === 'GET' && req.path === `/template-recipes/${sourceId}`) {
      res.set('Cache-Control', 'no-store').json(source);
      return;
    }
    if (req.method === 'POST' && req.path === `/templates/${sourceId}/repeat`) {
      if (!await hasVerifiedFixtureSession(req)) {
        res.status(401).json({ code: 'UNAUTHENTICATED', error: 'A real fixture Telegram session is required.' });
        return;
      }
      const requestId = req.body?.requestId;
      if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
        res.status(400).json({ error: 'Invalid fixture repeat request.' });
        return;
      }
      let view = copies.get(requestId);
      if (!view) {
        const video = file(randomUUID(), 'video/mp4');
        const image = file(randomUUID(), 'image/webp');
        view = {
          ...source,
          id: `repeat-${requestId}`,
          sourceTemplateId: sourceId,
          recipe: {
            ...recipe,
            references: { '/video_url': [video.id], '/image_urls': [image.id] },
          },
          files: { '/video_url': [video], '/image_urls': [image] },
        };
        copies.set(requestId, view);
      }
      res.status(201).json(view);
      return;
    }
    const repeatMatch = /^\/template-repeats\/(repeat-[0-9a-f-]{36})$/i.exec(req.path);
    if (req.method === 'GET' && repeatMatch) {
      if (!await hasVerifiedFixtureSession(req)) {
        res.status(401).json({ code: 'UNAUTHENTICATED', error: 'A real fixture Telegram session is required.' });
        return;
      }
      const view = [...copies.values()].find((item: any) => item.id === repeatMatch[1]);
      if (!view) { res.status(404).json({ error: 'Fixture repeat not found.' }); return; }
      res.set('Cache-Control', 'no-store').json(view);
      return;
    }
    if (req.method === 'GET' && /^\/media\/[0-9a-f-]{36}$/i.test(req.path)) {
      if (req.path.endsWith(sourceImageId) || [...copies.values()].some((view: any) => view.files['/image_urls'][0].url.endsWith(req.path.split('/').pop()))) {
        res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
        return;
      }
      res.status(404).end();
      return;
    }
    next();
  });

  app.use('/api/meduha', createMeduhaRouter(
    () => botToken,
    async () => null,
    async () => false,
    true,
  ));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Template repeat browser fixture failed to bind.');

  return {
    url: `http://127.0.0.1:${address.port}`,
    initData: signedInitData(botToken, accountId),
    accountId,
    sourceId,
    async stop() {
      if (fixtureStopped) return;
      fixtureStopped = true;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool.query('DELETE FROM meduha_sessions WHERE user_id = $1', [accountId]);
      await pool.query('DELETE FROM meduha_accounts WHERE id = $1', [accountId]);
    },
  };
}
