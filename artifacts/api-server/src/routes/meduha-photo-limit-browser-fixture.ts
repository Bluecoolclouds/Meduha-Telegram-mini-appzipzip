import { createHmac, createHash, randomInt } from 'node:crypto';
import { once } from 'node:events';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';

const sessionHash = (value: string) => createHash('sha256').update(value).digest('hex');

async function createUnusedAccountId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(4_503_599_003_000_000 + randomInt(1_000_000));
    const existing = await pool.query('SELECT 1 FROM meduha_accounts WHERE id = $1 LIMIT 1', [candidate]);
    if (existing.rowCount === 0) return candidate;
  }
  throw new Error('Could not allocate an unused Telegram fixture account ID.');
}

function signedInitData(botToken: string, accountId: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(accountId), first_name: 'Photo limit fixture' }),
  });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  fields.set(
    'hash',
    createHmac('sha256', secret)
      .update([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n'))
      .digest('hex'),
  );
  return fields.toString();
}

export async function startPhotoLimitBrowserFixture(sourceCatalog: Record<string, any>) {
  const catalogId = 'xai/grok-imagine-image-2.0';
  const modelId = '00000000-0000-4000-8000-000000000010';
  const referenceId = '00000000-0000-4000-8000-000000000011';
  const accountId = await createUnusedAccountId();
  const botToken = `${randomInt(1_000_000_000, 2_000_000_000)}:photo-limit-browser-test-only`;
  let generationSubmissions = 0;
  const modelFound = sourceCatalog.models?.some((model: { id?: string }) => model.id === catalogId);
  if (!modelFound) throw new Error(`The live photo catalog does not contain fixture model ${catalogId}.`);
  let fixtureStopped = false;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use('/api/meduha', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Meduha-Request') !== '1') {
      res.status(403).json({ code: 'REQUEST_ORIGIN_REQUIRED', error: 'Meduha request header is required.' });
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ code: 'CROSS_SITE_REQUEST', error: 'Cross-site request is not allowed.' });
      return;
    }
    next();
  });

  async function hasVerifiedFixtureSession(req: Request) {
    const raw = req.cookies?.meduha_session;
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return false;
    const result = await pool.query(
      `SELECT 1 FROM meduha_sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()`,
      [sessionHash(raw), accountId],
    );
    return result.rowCount === 1;
  }

  app.use('/api/meduha', async (req: Request, res: Response, next) => {
    if (req.method === 'GET' && req.path === '/photo/catalog') {
      res.json({
        ...sourceCatalog,
        spendingEnabled: true,
        providerConfigured: true,
        storageConfigured: true,
        models: sourceCatalog.models.map((model: Record<string, unknown>) => model.id === catalogId
          ? { ...model, modelId, available: true, creditPrice: 10, pricingBlockedReason: null }
          : model),
      });
      return;
    }
    if (req.method === 'GET' && req.path === `/media/${referenceId}`) {
      res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      return;
    }
    if (req.method === 'GET' && req.path === '/generations') {
      if (!await hasVerifiedFixtureSession(req)) {
        res.status(401).json({ code: 'UNAUTHENTICATED', error: 'A real fixture Telegram session is required.' });
        return;
      }
      res.json({ items: [] });
      return;
    }
    if (req.method === 'POST' && req.path === '/photo/quote') {
      if (!await hasVerifiedFixtureSession(req)) {
        res.status(401).json({ code: 'UNAUTHENTICATED', error: 'A real fixture Telegram session is required.' });
        return;
      }
      res.json({
        token: `fixture-quote-${String(req.body?.idempotencyKey ?? 'missing')}`,
        creditPrice: 10,
        expiresAt: Date.now() + 300_000,
        images: 1,
        referenceCount: 1,
        resolution: '1K',
        quality: 'standard',
        modelDailyLimit: 100,
        modelDailyRemaining: 100,
      });
      return;
    }
    if (req.method === 'POST' && req.path === '/photo/generations') {
      if (!await hasVerifiedFixtureSession(req)) {
        res.status(401).json({ code: 'UNAUTHENTICATED', error: 'A real fixture Telegram session is required.' });
        return;
      }
      generationSubmissions++;
      res.status(409).json(generationSubmissions === 1
        ? { code: 'DAILY_LIMIT_EXCEEDED', error: 'Дневной лимит изменился после расчёта' }
        : { code: 'INSUFFICIENT_CREDITS', error: 'Недостаточно кредитов в тестовой фикстуре' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.path !== '/auth/telegram') {
      res.status(400).json({ code: 'UNEXPECTED_FIXTURE_MUTATION', error: 'Unexpected fixture mutation.' });
      return;
    }
    next();
  });
  app.use('/api/meduha', createMeduhaRouter(() => botToken, async () => 'photo_limit_fixture_bot'));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Photo limit browser fixture failed to bind.');

  return {
    url: `http://127.0.0.1:${address.port}`,
    initData: signedInitData(botToken, accountId),
    accountId,
    async stop() {
      if (fixtureStopped) return;
      fixtureStopped = true;
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      await pool.query('DELETE FROM meduha_sessions WHERE user_id = $1', [accountId]);
      await pool.query('DELETE FROM meduha_accounts WHERE id = $1', [accountId]);
    },
  };
}
