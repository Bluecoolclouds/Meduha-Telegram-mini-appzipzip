import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, count, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  db, meduhaAccounts, meduhaAdminAudit, meduhaAdminPairings, meduhaAdminSessions,
  meduhaAiChannels, meduhaAiModels, meduhaReports,
  meduhaTemplates, meduhaWorks, pool,
} from '@workspace/db';
import {
  AdjustAdminCreditsBody, CreateAdminChannelBody, CreateAdminChannelResponse,
  CreateAdminModelBody, CreateAdminModelResponse, GetAdminChannelResponse, GetAdminModelResponse,
  GetAdminFinanceSettingsResponse, GetAdminStatisticsResponse, GetAdminUserResponse,
  GetAdminWalletQueryParams, GetAdminWalletResponse,
  GetMeduhaAdminStatusResponse, IssueMeduhaAdminPairingResponse, ListAdminAuditQueryParams,
  ListAdminAuditResponse, ListAdminChannelsResponse, ListAdminJobsResponse,
  ListAdminJobsQueryParams, ListAdminReportsQueryParams, ListAdminTemplatesQueryParams,
  ListAdminLedgerQueryParams, ListAdminLedgerResponse, ListAdminModelsResponse,
  ListAdminReportsResponse, ListAdminTemplatesResponse, ListAdminUsersQueryParams,
  ListAdminUsersResponse, LoginMeduhaAdminPairingBody, LoginMeduhaAdminPairingResponse,
  LoginMeduhaAdminPasswordBody, LoginMeduhaAdminPasswordResponse,
  ModerateAdminTemplateBody, ModerateAdminTemplateResponse,
  RefundAdminCreditsBody, ReleaseAdminCreditsBody, ReserveAdminCreditsBody,
  ResolveAdminReportBody, ResolveAdminReportResponse, SettleAdminCreditsBody,
  SetAdminUserBlockedBody, SetAdminUserBlockedResponse, UpdateAdminChannelBody,
  UpdateAdminChannelResponse, UpdateAdminFinanceSettingsBody, UpdateAdminModelBody,
  UpdateAdminModelResponse, AdjustAdminCreditsResponse, ReserveAdminCreditsResponse,
  SettleAdminCreditsResponse, ReleaseAdminCreditsResponse, RefundAdminCreditsResponse,
  GetHiggsfieldCatalogResponse, ImportHiggsfieldCatalogModelsBody, ImportHiggsfieldCatalogModelsResponse,
  ListAdminSessionsResponse, RevokeAdminSessionParams, RevokeOtherAdminSessionsResponse,
} from '@workspace/api-zod';
import { currentAccount } from './meduha';
import { designatedAdminId, isAdminSetupRequired, isTemplateAdmin } from '../lib/template-admin';
import {
  adjustWallet, FinanceError, getFinanceSettings, getFinanceStats, getWallet, type FinanceSettings,
  refundReservation, releaseReservation, reserveCredits, settleReservation, updateFinanceSettings,
} from '../lib/finance';
import { getFreshHiggsfieldCatalog, refreshHiggsfieldCatalog } from '../lib/higgsfield-catalog';
import { applyGenerationProviderStatus, finalizeResolvedGeneration, type GenerationVideoStore } from '../lib/generation-worker';
import { getHiggsfieldRequestStatus } from '../lib/higgsfield';
import {
  TEMPORARY_ADMIN_ACTOR, allowPasswordAttempt, temporaryAdminConfig, validTemporaryCredentials,
  PASSWORD_ATTEMPT_WINDOW_MS,
} from '../lib/temporary-admin';

const COOKIE = 'meduha_admin_session';
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const PAIRING_MS = 5 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = (req: Request) => {
  const value: unknown = req.cookies?.[COOKIE];
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
};
const cookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: req.secure || process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/meduha/admin',
});
const error = (res: Response, status: number, code: string, message: string) => {
  res.status(status).json({ code, error: message });
};
const pathParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};
const GENJUTSU_SCENARIO_BY_UPSTREAM = new Map([
  ['higgsfield/genjutsu/motion-transfer/v1.0', 'genjutsu'],
  ['higgsfield/genjutsu/object-swap/v1.0', 'object-swap'],
  ['higgsfield/genjutsu/restyle/v1.0', 'restyle'],
]);
function validGenjutsuTariffs(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return false;
    const tariff = entry as Record<string, unknown>;
    if (!['genjutsu', 'object-swap', 'restyle'].includes(String(tariff.scenario))
      || !['480p', '720p', '1080p'].includes(String(tariff.resolution))
      || !Number.isSafeInteger(tariff.duration) || Number(tariff.duration) < 4 || Number(tariff.duration) > 30
      || !Number.isSafeInteger(tariff.creditPrice) || Number(tariff.creditPrice) < 1) return false;
    const key = `${tariff.scenario}:${tariff.resolution}:${tariff.duration}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
function tariffsMatchGenjutsuModel(value: unknown[], upstreamId: string): boolean {
  const scenario = GENJUTSU_SCENARIO_BY_UPSTREAM.get(upstreamId);
  return !!scenario && value.every(entry => (entry as Record<string, unknown>).scenario === scenario);
}

async function activeAdminId(req: Request, isDesignatedAdmin: (id: string) => Promise<boolean> = isTemplateAdmin, readTemporaryConfig = temporaryAdminConfig): Promise<string | null> {
  const raw = token(req);
  if (!raw) {
    const account = await currentAccount(req);
    return account && !account.blocked && await isDesignatedAdmin(account.id) ? account.id : null;
  }
  const [session] = await db.select().from(meduhaAdminSessions)
    .where(and(
      eq(meduhaAdminSessions.tokenHash, hash(raw)),
      gt(meduhaAdminSessions.expiresAt, sql<Date>`clock_timestamp()`),
    ))
    .limit(1);
  if (!session) return null;
  if (session.authMethod === 'temporary') {
    const config = readTemporaryConfig();
    if (config && session.adminId === TEMPORARY_ADMIN_ACTOR && session.configFingerprint === config.fingerprint) {
      return TEMPORARY_ADMIN_ACTOR;
    }
    await db.delete(meduhaAdminSessions).where(eq(meduhaAdminSessions.tokenHash, hash(raw)));
    return null;
  }
  if (session.authMethod !== 'telegram' || !await isActiveAccount(session.adminId) || !await isDesignatedAdmin(session.adminId)) return null;
  return session.adminId;
}

async function requireDesignatedAdmin(req: Request, res: Response, isDesignatedAdmin: (id: string) => Promise<boolean> = isTemplateAdmin, readTemporaryConfig = temporaryAdminConfig): Promise<string | null> {
  const id = await activeAdminId(req, isDesignatedAdmin, readTemporaryConfig);
  if (id) return id;
  error(res, 403, 'ADMIN_REQUIRED', 'Для этой операции нужна назначенная действующая учётная запись администратора.');
  return null;
}
async function isActiveAccount(id: string): Promise<boolean> {
  const [row] = await db.select({ id: meduhaAccounts.id }).from(meduhaAccounts)
    .where(and(eq(meduhaAccounts.id, id), eq(meduhaAccounts.blocked, false))).limit(1);
  return !!row;
}

async function audit(
  actorId: string, action: string, entityType: string, entityId: string | null = null,
  details: Record<string, string | number | boolean | null> = {},
) {
  await db.insert(meduhaAdminAudit).values({ actorId, action, entityType, entityId, details });
}

async function financeAction(
  res: Response,
  actorId: string,
  action: string,
  entityId: string | null,
  reason: string,
  execute: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await execute() as { replayed?: boolean };
    if (!result.replayed) await audit(actorId, action, 'finance', entityId, { reason });
    res.json(result);
  } catch (caught) {
    if (caught instanceof FinanceError) {
      const status = caught.code === 'ACCOUNT_NOT_FOUND' || caught.code === 'RESERVATION_NOT_FOUND' ? 404
        : caught.code === 'INVALID_INPUT' ? 400
          : caught.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 409;
      error(res, status, caught.code, caught.message);
      return;
    }
    throw caught;
  }
}

export function createMeduhaAdminRouter(
  isDesignatedAdmin: (id: string) => Promise<boolean> = isTemplateAdmin,
  setupRequiredForTest = false,
  catalogFetcher: typeof fetch = fetch,
  providerStatusFetcher: typeof getHiggsfieldRequestStatus = getHiggsfieldRequestStatus,
  storeGenerationVideoForTest?: GenerationVideoStore,
  readTemporaryConfig = temporaryAdminConfig,
) {
const router = Router();
const requiredAdmin = (req: Request, res: Response) => requireDesignatedAdmin(req, res, isDesignatedAdmin, readTemporaryConfig);

router.get('/admin/login', async (req, res): Promise<void> => {
  const adminId = await activeAdminId(req, isDesignatedAdmin, readTemporaryConfig);
  const setupRequired = setupRequiredForTest && isDesignatedAdmin !== isTemplateAdmin
    ? false
    : await isAdminSetupRequired();
  res.setHeader('Cache-Control', 'no-store');
  res.json(GetMeduhaAdminStatusResponse.parse({
    authenticated: !!adminId,
    isAdmin: !!adminId,
    setupRequired,
    adminId: adminId ?? undefined,
    authMethod: adminId ? (adminId === TEMPORARY_ADMIN_ACTOR ? 'temporary' : 'telegram') : undefined,
    passwordLoginAvailable: !!readTemporaryConfig(),
    pairingLoginAvailable: !setupRequired,
  }));
});

router.post('/admin/login/password', async (req, res): Promise<void> => {
  if (!await allowPasswordAttempt(req.ip ?? 'unknown')) {
    res.setHeader('Retry-After', String(PASSWORD_ATTEMPT_WINDOW_MS / 1000));
    error(res, 429, 'ADMIN_LOGIN_RATE_LIMIT', 'Слишком много попыток входа. Повтори через 15 минут.');
    return;
  }
  const config = readTemporaryConfig();
  const body = LoginMeduhaAdminPasswordBody.strict().safeParse(req.body);
  if (!body.success || !validTemporaryCredentials(config, body.data.login, body.data.password) || !config) {
    error(res, 401, 'ADMIN_CREDENTIALS_INVALID', 'Неверный логин или пароль, либо временный вход отключён.');
    return;
  }
  const raw = randomBytes(32).toString('hex');
  const previous = token(req);
  const session = await db.transaction(async tx => {
    if (previous) await tx.delete(meduhaAdminSessions).where(eq(meduhaAdminSessions.tokenHash, hash(previous)));
    const [created] = await tx.insert(meduhaAdminSessions).values({
      tokenHash: hash(raw), adminId: TEMPORARY_ADMIN_ACTOR, authMethod: 'temporary',
      configFingerprint: config.fingerprint,
      expiresAt: sql<Date>`clock_timestamp() + (${ADMIN_SESSION_MS} * interval '1 millisecond')`,
    }).returning({ expiresAt: meduhaAdminSessions.expiresAt });
    await tx.insert(meduhaAdminAudit).values({
      actorId: TEMPORARY_ADMIN_ACTOR, action: 'auth.password.login', entityType: 'admin-session', entityId: hash(raw),
      details: { authMethod: 'temporary' },
    });
    return created;
  });
  res.cookie(COOKIE, raw, { ...cookieOptions(req), maxAge: ADMIN_SESSION_MS });
  res.setHeader('Cache-Control', 'no-store');
  res.json(LoginMeduhaAdminPasswordResponse.parse({
    authenticated: true, isAdmin: true, setupRequired: false, expiresAt: session.expiresAt,
  }));
});

router.post('/admin/pairing', async (req, res): Promise<void> => {
  const account = await currentAccount(req);
  if (!account) { error(res, 401, 'SESSION_REQUIRED', 'Войди через Telegram, чтобы запросить код.'); return; }
  if (account.blocked || !await isDesignatedAdmin(account.id)) { error(res, 403, 'ADMIN_REQUIRED', 'Код доступен только назначенному администратору.'); return; }
  const raw = randomBytes(32).toString('hex');
  const [pairing] = await db.insert(meduhaAdminPairings).values({
    codeHash: hash(raw),
    adminId: account.id,
    expiresAt: sql<Date>`clock_timestamp() + (${PAIRING_MS} * interval '1 millisecond')`,
  }).returning({ expiresAt: meduhaAdminPairings.expiresAt });
  res.status(201).json(IssueMeduhaAdminPairingResponse.parse({ code: raw, expiresAt: pairing.expiresAt }));
});

router.post('/admin/login', async (req, res): Promise<void> => {
  const body = LoginMeduhaAdminPairingBody.safeParse(req.body);
  if (!body.success) { error(res, 400, 'INVALID_INPUT', 'Некорректный код сопряжения.'); return; }
  const consumed = await db.transaction(async tx => {
    const [pairing] = await tx.update(meduhaAdminPairings).set({ consumedAt: sql<Date>`clock_timestamp()` })
      .where(and(
        eq(meduhaAdminPairings.codeHash, hash(body.data.code)),
        isNull(meduhaAdminPairings.consumedAt),
        gt(meduhaAdminPairings.expiresAt, sql<Date>`clock_timestamp()`),
      )).returning({ adminId: meduhaAdminPairings.adminId });
    return pairing?.adminId ?? null;
  });
  if (!consumed || !await isDesignatedAdmin(consumed) || !await isActiveAccount(consumed)) { error(res, 401, 'PAIRING_INVALID', 'Код недействителен или уже использован.'); return; }
  const raw = randomBytes(32).toString('hex');
  const [session] = await db.insert(meduhaAdminSessions).values({
    tokenHash: hash(raw),
    adminId: consumed,
    expiresAt: sql<Date>`clock_timestamp() + (${ADMIN_SESSION_MS} * interval '1 millisecond')`,
  }).returning({ expiresAt: meduhaAdminSessions.expiresAt });
  res.cookie(COOKIE, raw, { ...cookieOptions(req), maxAge: ADMIN_SESSION_MS });
  res.setHeader('Cache-Control', 'no-store');
  res.json(LoginMeduhaAdminPairingResponse.parse({
    authenticated: true, isAdmin: true, setupRequired: false, expiresAt: session.expiresAt,
  }));
});

router.post('/admin/logout', async (req, res): Promise<void> => {
  const raw = token(req);
  if (raw) await db.delete(meduhaAdminSessions).where(eq(meduhaAdminSessions.tokenHash, hash(raw)));
  res.clearCookie(COOKIE, cookieOptions(req));
  res.sendStatus(204);
});

router.get('/admin/sessions', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const raw = token(req);
  const sessions = await db.select({
    id: meduhaAdminSessions.id,
    authMethod: meduhaAdminSessions.authMethod,
    createdAt: meduhaAdminSessions.createdAt,
    expiresAt: meduhaAdminSessions.expiresAt,
    current: raw ? sql<boolean>`${meduhaAdminSessions.tokenHash} = ${hash(raw)}` : sql<boolean>`false`,
  }).from(meduhaAdminSessions)
    .where(gt(meduhaAdminSessions.expiresAt, sql<Date>`clock_timestamp()`))
    .orderBy(desc(meduhaAdminSessions.createdAt));
  res.json(ListAdminSessionsResponse.parse(sessions));
});

router.delete('/admin/sessions/:sessionId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const params = RevokeAdminSessionParams.safeParse(req.params);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректный идентификатор сеанса.'); return; }
  const raw = token(req);
  const revoked = await db.transaction(async tx => {
    const [session] = await tx.delete(meduhaAdminSessions).where(and(
      eq(meduhaAdminSessions.id, params.data.sessionId),
      gt(meduhaAdminSessions.expiresAt, sql<Date>`clock_timestamp()`),
      raw ? sql<boolean>`${meduhaAdminSessions.tokenHash} <> ${hash(raw)}` : sql<boolean>`true`,
    )).returning({ id: meduhaAdminSessions.id, authMethod: meduhaAdminSessions.authMethod });
    if (session) {
      await tx.insert(meduhaAdminAudit).values({
        actorId: actor, action: 'auth.session.revoke', entityType: 'admin-session', entityId: session.id,
        details: { authMethod: session.authMethod },
      });
    }
    return session;
  });
  if (!revoked) { error(res, 404, 'ADMIN_SESSION_NOT_FOUND', 'Сеанс не найден, уже завершён или является текущим.'); return; }
  res.sendStatus(204);
});

router.delete('/admin/sessions', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const raw = token(req);
  const revokedCount = await db.transaction(async tx => {
    const [actorSession] = raw
      ? await tx.select({ authMethod: meduhaAdminSessions.authMethod }).from(meduhaAdminSessions)
        .where(and(
          eq(meduhaAdminSessions.tokenHash, hash(raw)),
          gt(meduhaAdminSessions.expiresAt, sql<Date>`clock_timestamp()`),
        )).limit(1)
      : [];
    const deleted = await tx.delete(meduhaAdminSessions).where(and(
      gt(meduhaAdminSessions.expiresAt, sql<Date>`clock_timestamp()`),
      raw ? sql<boolean>`${meduhaAdminSessions.tokenHash} <> ${hash(raw)}` : sql<boolean>`true`,
    )).returning({ id: meduhaAdminSessions.id });
    if (deleted.length) {
      await tx.insert(meduhaAdminAudit).values({
        actorId: actor, action: 'auth.sessions.revoke_others', entityType: 'admin-session',
        details: {
          authMethod: actorSession?.authMethod ?? (actor === TEMPORARY_ADMIN_ACTOR ? 'temporary' : 'telegram'),
          revokedCount: deleted.length,
        },
      });
    }
    return deleted.length;
  });
  res.json(RevokeOtherAdminSessionsResponse.parse({ revokedCount }));
});

router.get('/admin/channels', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const rows = await db.select().from(meduhaAiChannels).orderBy(meduhaAiChannels.priority, meduhaAiChannels.name);
  res.json(ListAdminChannelsResponse.parse(rows));
});
router.post('/admin/channels', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const parsed = CreateAdminChannelBody.strict().safeParse(req.body);
  if (!parsed.success || !validHttpsUrl(parsed.data?.baseUrl) || !validSecretRef(parsed.data?.secretRef)) { error(res, 400, 'INVALID_INPUT', 'Проверь HTTPS-адрес, ссылку на секрет и настройки канала.'); return; }
  const [row] = await db.insert(meduhaAiChannels).values({
    id: randomUUID(), ...parsed.data, enabled: parsed.data.enabled ?? false,
    updatedAt: new Date(),
  }).returning();
  await audit(actor, 'channel.create', 'channel', row.id);
  res.status(201).json(CreateAdminChannelResponse.parse(row));
});
router.get('/admin/channels/:channelId', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const [row] = await db.select().from(meduhaAiChannels).where(eq(meduhaAiChannels.id, pathParam(req, 'channelId'))).limit(1);
  if (!row) { error(res, 404, 'NOT_FOUND', 'Канал не найден.'); return; }
  res.json(GetAdminChannelResponse.parse(row));
});
router.patch('/admin/channels/:channelId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const parsed = UpdateAdminChannelBody.strict().safeParse(req.body);
  if (!parsed.success || (parsed.data.baseUrl !== undefined && !validHttpsUrl(parsed.data.baseUrl)) || !validSecretRef(parsed.data.secretRef)) { error(res, 400, 'INVALID_INPUT', 'Проверь настройки канала.'); return; }
  const [row] = await db.update(meduhaAiChannels).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(meduhaAiChannels.id, pathParam(req, 'channelId'))).returning();
  if (!row) { error(res, 404, 'NOT_FOUND', 'Канал не найден.'); return; }
  await audit(actor, 'channel.update', 'channel', row.id);
  res.json(UpdateAdminChannelResponse.parse(row));
});
router.delete('/admin/channels/:channelId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const [row] = await db.delete(meduhaAiChannels).where(eq(meduhaAiChannels.id, pathParam(req, 'channelId'))).returning({ id: meduhaAiChannels.id });
  if (!row) { error(res, 404, 'NOT_FOUND', 'Канал не найден.'); return; }
  await audit(actor, 'channel.delete', 'channel', row.id);
  res.sendStatus(204);
});

router.get('/admin/models', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  res.json(ListAdminModelsResponse.parse(await db.select().from(meduhaAiModels).orderBy(meduhaAiModels.displayName)));
});
router.post('/admin/models', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const parsed = CreateAdminModelBody.strict().safeParse(req.body);
  if (!parsed.success) { error(res, 400, 'INVALID_INPUT', 'Проверь настройки модели.'); return; }
  const genjutsuPricing = parsed.data.genjutsuPricing ?? [];
  if (!validGenjutsuTariffs(genjutsuPricing)
    || (genjutsuPricing.length > 0 && !tariffsMatchGenjutsuModel(genjutsuPricing, parsed.data.upstreamId))) {
    error(res, 400, 'INVALID_INPUT', 'Проверь тарифы Genjutsu: укажи уникальные сценарий, качество, длительность и цену только для модели Genjutsu.');
    return;
  }
  const [channel] = await db.select({ id: meduhaAiChannels.id, adapter: meduhaAiChannels.adapter })
    .from(meduhaAiChannels).where(eq(meduhaAiChannels.id, parsed.data.channelId)).limit(1);
  if (!channel) { error(res, 404, 'CHANNEL_NOT_FOUND', 'Канал не найден.'); return; }
  if (genjutsuPricing.length > 0 && channel.adapter !== 'higgsfield') {
    error(res, 400, 'INVALID_INPUT', 'Тарифы Genjutsu можно привязать только к каналу Higgsfield.');
    return;
  }
  const [row] = await db.insert(meduhaAiModels).values({
    id: randomUUID(), ...parsed.data, enabled: parsed.data.enabled ?? false,
    genjutsuPricing, estimatedCost: parsed.data.estimatedCost ?? null, limits: parsed.data.limits ?? {}, updatedAt: new Date(),
  }).returning();
  await audit(actor, 'model.create', 'model', row.id);
  res.status(201).json(CreateAdminModelResponse.parse(row));
});
router.get('/admin/models/:modelId', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const [row] = await db.select().from(meduhaAiModels).where(eq(meduhaAiModels.id, pathParam(req, 'modelId'))).limit(1);
  if (!row) { error(res, 404, 'NOT_FOUND', 'Модель не найдена.'); return; }
  res.json(GetAdminModelResponse.parse(row));
});
router.patch('/admin/models/:modelId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const parsed = UpdateAdminModelBody.strict().safeParse(req.body);
  if (!parsed.success) { error(res, 400, 'INVALID_INPUT', 'Проверь настройки модели.'); return; }
  const modelId = pathParam(req, 'modelId');
  if (parsed.data.genjutsuPricing !== undefined && !validGenjutsuTariffs(parsed.data.genjutsuPricing)) {
    error(res, 400, 'INVALID_INPUT', 'Проверь тарифы Genjutsu: сочетания сценария, качества и длительности должны быть уникальными.');
    return;
  }
  if (parsed.data.genjutsuPricing !== undefined || parsed.data.upstreamId !== undefined || parsed.data.channelId !== undefined) {
    const [current] = await db.select({
      upstreamId: meduhaAiModels.upstreamId,
      channelId: meduhaAiModels.channelId,
      genjutsuPricing: meduhaAiModels.genjutsuPricing,
    }).from(meduhaAiModels)
      .where(eq(meduhaAiModels.id, modelId)).limit(1);
    const genjutsuPricing = parsed.data.genjutsuPricing ?? current?.genjutsuPricing ?? [];
    const upstreamId = parsed.data.upstreamId ?? current?.upstreamId;
    const channelId = parsed.data.channelId ?? current?.channelId;
    if (genjutsuPricing.length > 0) {
      if (!upstreamId || !tariffsMatchGenjutsuModel(genjutsuPricing, upstreamId)) {
        error(res, 400, 'INVALID_INPUT', 'Сценарий тарифа должен соответствовать endpoint модели Genjutsu.');
        return;
      }
      const [channel] = channelId
        ? await db.select({ adapter: meduhaAiChannels.adapter }).from(meduhaAiChannels)
          .where(eq(meduhaAiChannels.id, channelId)).limit(1)
        : [];
      if (!channel || channel.adapter !== 'higgsfield') {
        error(res, 400, 'INVALID_INPUT', 'Тарифы Genjutsu можно привязать только к каналу Higgsfield.');
        return;
      }
    }
  }
  if (parsed.data.channelId) {
    const [channel] = await db.select({ id: meduhaAiChannels.id }).from(meduhaAiChannels).where(eq(meduhaAiChannels.id, parsed.data.channelId)).limit(1);
    if (!channel) { error(res, 404, 'CHANNEL_NOT_FOUND', 'Канал не найден.'); return; }
  }
  const [row] = await db.update(meduhaAiModels).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(meduhaAiModels.id, modelId)).returning();
  if (!row) { error(res, 404, 'NOT_FOUND', 'Модель не найдена.'); return; }
  await audit(actor, 'model.update', 'model', row.id);
  res.json(UpdateAdminModelResponse.parse(row));
});
router.delete('/admin/models/:modelId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const [row] = await db.delete(meduhaAiModels).where(eq(meduhaAiModels.id, pathParam(req, 'modelId'))).returning({ id: meduhaAiModels.id });
  if (!row) { error(res, 404, 'NOT_FOUND', 'Модель не найдена.'); return; }
  await audit(actor, 'model.delete', 'model', row.id);
  res.sendStatus(204);
});

router.get('/admin/higgsfield/catalog', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const catalog = await refreshHiggsfieldCatalog(catalogFetcher);
    res.json(GetHiggsfieldCatalogResponse.parse(catalog));
  } catch (caught) {
    req.log.warn({ err: caught }, 'Higgsfield documented catalog refresh failed');
    error(res, 503, 'CATALOG_UNAVAILABLE', 'Официальный каталог Higgsfield сейчас недоступен. Повтори обновление позже.');
  }
});

router.post('/admin/higgsfield/import', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const parsed = ImportHiggsfieldCatalogModelsBody.strict().safeParse(req.body);
  if (!parsed.success) { error(res, 400, 'INVALID_INPUT', 'Проверь канал и выбранные модели каталога.'); return; }

  let catalog;
  try {
    catalog = await getFreshHiggsfieldCatalog(catalogFetcher);
  } catch (caught) {
    req.log.warn({ err: caught }, 'Higgsfield catalog unavailable during model import');
    error(res, 503, 'CATALOG_UNAVAILABLE', 'Не удалось проверить свежий каталог Higgsfield. Импорт не выполнен.');
    return;
  }
  if (catalog.status === 'stale') {
    error(res, 503, 'CATALOG_STALE', 'Импорт из устаревшего каталога запрещён. Сначала обнови каталог.');
    return;
  }
  const byId = new Map(catalog.entries.map(entry => [entry.endpointId, entry]));
  const entries = parsed.data.endpointIds.map(id => byId.get(id));
  if (entries.some(entry => !entry)) {
    error(res, 400, 'MODEL_NOT_IN_CATALOG', 'Один или несколько выбранных endpoint ID отсутствуют в проверенном каталоге.');
    return;
  }

  const outcome = await db.transaction(async tx => {
    const [channel] = await tx.select().from(meduhaAiChannels)
      .where(eq(meduhaAiChannels.id, parsed.data.channelId)).for('update').limit(1);
    if (!channel) return { missingChannel: true as const, notHiggsfield: false, imported: [], skipped: [] as string[] };
    if (channel.adapter.toLowerCase() !== 'higgsfield') {
      return { missingChannel: false, notHiggsfield: true as const, imported: [], skipped: [] as string[] };
    }

    const existing = await tx.select({
      id: meduhaAiModels.id,
      upstreamId: meduhaAiModels.upstreamId,
      providerSchemaUrl: meduhaAiModels.providerSchemaUrl,
      providerSchema: meduhaAiModels.providerSchema,
    }).from(meduhaAiModels)
      .where(eq(meduhaAiModels.channelId, channel.id));
    const existingByUpstreamId = new Map(existing.map(row => [row.upstreamId, row]));
    const known = new Set(existingByUpstreamId.keys());
    const imported = [];
    const skipped: string[] = [];
    const updated: string[] = [];
    const updatedModelIds: string[] = [];
    for (const entry of entries) {
      if (!entry) continue;
      if (known.has(entry.endpointId)) {
        skipped.push(entry.endpointId);
        const existingModel = existingByUpstreamId.get(entry.endpointId);
        const keepLastKnownSchema = Boolean(existingModel?.providerSchema?.schemaAvailable && !entry.schemaAvailable);
        const providerSchema = keepLastKnownSchema
          ? existingModel!.providerSchema!
          : { schemaAvailable: entry.schemaAvailable, parameters: entry.parameters };
        const providerSchemaUrl = keepLastKnownSchema && existingModel?.providerSchemaUrl
          ? existingModel.providerSchemaUrl
          : entry.docsUrl;
        if (existingModel && (
          existingModel.providerSchemaUrl !== providerSchemaUrl
          || !isDeepStrictEqual(existingModel.providerSchema, providerSchema)
        )) {
          await tx.update(meduhaAiModels).set({
            providerSchemaUrl,
            providerSchema,
            updatedAt: new Date(),
          }).where(eq(meduhaAiModels.id, existingModel.id));
          updated.push(entry.endpointId);
          updatedModelIds.push(existingModel.id);
        }
        continue;
      }
      const [row] = await tx.insert(meduhaAiModels).values({
        id: randomUUID(),
        channelId: channel.id,
        upstreamId: entry.endpointId,
        displayName: entry.displayName.slice(0, 120),
        kind: entry.kind,
        enabled: false,
        creditPrice: 0,
        estimatedCost: null,
        limits: {},
        providerSchemaUrl: entry.docsUrl,
        providerSchema: { schemaAvailable: entry.schemaAvailable, parameters: entry.parameters },
        updatedAt: new Date(),
      }).returning();
      imported.push(row);
      known.add(entry.endpointId);
    }
    return { missingChannel: false as const, notHiggsfield: false as const, imported, skipped, updated, updatedModelIds };
  });
  if (outcome.missingChannel) { error(res, 404, 'CHANNEL_NOT_FOUND', 'Канал не найден.'); return; }
  if (outcome.notHiggsfield) { error(res, 400, 'INVALID_CHANNEL', 'Импорт каталога доступен только для канала Higgsfield.'); return; }
  for (const row of outcome.imported) await audit(actor, 'model.import', 'model', row.id, { source: 'higgsfield-catalog' });
  for (const modelId of outcome.updatedModelIds) {
    await audit(actor, 'model.provider-schema.update', 'model', modelId, { source: 'higgsfield-catalog' });
  }
  res.json(ImportHiggsfieldCatalogModelsResponse.parse({
    imported: outcome.imported,
    skipped: outcome.skipped,
    updated: outcome.updated,
  }));
});

router.get('/admin/finance', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  res.json(GetAdminFinanceSettingsResponse.parse(await getFinanceSettings()));
});
router.patch('/admin/finance', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = UpdateAdminFinanceSettingsBody.strict().safeParse(req.body);
  if (!body.success) { error(res, 400, 'INVALID_INPUT', 'Проверь настройки списания кредитов.'); return; }
  let settings: FinanceSettings;
  try {
    settings = await updateFinanceSettings(body.data, actor);
  } catch (caught) {
    if (caught instanceof FinanceError) { error(res, 400, caught.code, caught.message); return; }
    throw caught;
  }
  await audit(actor, 'finance.settings.update', 'finance-settings', null, {
    spendingEnabled: settings.spendingEnabled,
    dailyCreditLimit: settings.dailyCreditLimit,
    perAccountDailyCreditLimit: settings.perAccountDailyCreditLimit,
    maxActiveReservations: settings.maxActiveReservations,
  });
  res.json(GetAdminFinanceSettingsResponse.parse(settings));
});
router.get('/admin/ledger', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminLedgerQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры журнала кредитов.'); return; }
  const { limit, offset } = params.data;
  const [items, totals] = await Promise.all([
    pool.query(
      `SELECT id, account_id AS "accountId", actor_id AS "actorId", kind, delta,
        reserved_delta AS "reservedDelta", budget_delta AS "budgetDelta", budget_day::text AS "budgetDay",
        reservation_id AS "reservationId", reason, idempotency_key AS "idempotencyKey", created_at AS "createdAt"
       FROM meduha_finance_ledger ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query('SELECT COUNT(*)::bigint AS total FROM meduha_finance_ledger'),
  ]);
  res.json(ListAdminLedgerResponse.parse({ items: items.rows, total: Number(totals.rows[0].total), limit, offset }));
});
router.post('/admin/credits/adjust', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = AdjustAdminCreditsBody.strict().safeParse(req.body);
  if (!body.success || !body.data.reason.trim()) { error(res, 400, 'INVALID_INPUT', 'Проверь сумму, причину и ключ операции.'); return; }
  await financeAction(res, actor, 'credits.adjust', body.data.userId, body.data.reason, async () => AdjustAdminCreditsResponse.parse(await adjustWallet({
    accountId: body.data.userId, actorId: actor, delta: body.data.delta,
    reason: body.data.reason, idempotencyKey: body.data.idempotencyKey,
  })));
});
router.post('/admin/credits/reserve', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = ReserveAdminCreditsBody.strict().safeParse(req.body);
  if (!body.success || !body.data.reason.trim()) { error(res, 400, 'INVALID_INPUT', 'Проверь сумму, причину и ключ операции.'); return; }
  await financeAction(res, actor, 'credits.reserve', body.data.userId, body.data.reason, async () => ReserveAdminCreditsResponse.parse(await reserveCredits({
    accountId: body.data.userId, actorId: actor, amount: body.data.amount,
    reason: body.data.reason, idempotencyKey: body.data.idempotencyKey,
    modelId: body.data.modelId ?? undefined, channelId: body.data.channelId ?? undefined,
  })));
});
router.post('/admin/credits/:reservationId/settle', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = SettleAdminCreditsBody.strict().safeParse(req.body);
  if (!body.success || !body.data.reason.trim()) { error(res, 400, 'INVALID_INPUT', 'Проверь причину и ключ операции.'); return; }
  await financeAction(res, actor, 'credits.settle', pathParam(req, 'reservationId'), body.data.reason, async () => SettleAdminCreditsResponse.parse(await settleReservation({
    reservationId: pathParam(req, 'reservationId'), actorId: actor, idempotencyKey: body.data.idempotencyKey, reason: body.data.reason,
  })));
});
router.post('/admin/credits/:reservationId/release', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = ReleaseAdminCreditsBody.strict().safeParse(req.body);
  if (!body.success || !body.data.reason.trim()) { error(res, 400, 'INVALID_INPUT', 'Проверь причину и ключ операции.'); return; }
  await financeAction(res, actor, 'credits.release', pathParam(req, 'reservationId'), body.data.reason, async () => ReleaseAdminCreditsResponse.parse(await releaseReservation({
    reservationId: pathParam(req, 'reservationId'), actorId: actor, idempotencyKey: body.data.idempotencyKey, reason: body.data.reason,
  })));
});
router.post('/admin/credits/:reservationId/refund', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = RefundAdminCreditsBody.strict().safeParse(req.body);
  if (!body.success || !body.data.reason.trim()) { error(res, 400, 'INVALID_INPUT', 'Проверь причину и ключ операции.'); return; }
  await financeAction(res, actor, 'credits.refund', pathParam(req, 'reservationId'), body.data.reason, async () => RefundAdminCreditsResponse.parse(await refundReservation({
    reservationId: pathParam(req, 'reservationId'), actorId: actor, idempotencyKey: body.data.idempotencyKey, reason: body.data.reason,
  })));
});

router.get('/admin/generations/seedance', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const { rows } = await pool.query(
    `SELECT j.id, j.account_id AS "accountId", j.status, j.request_id AS "requestId",
       j.provider_status AS "providerStatus", j.input, j.credit_price AS "creditPrice",
       j.reservation_id AS "reservationId", r.status AS "reservationStatus",
       r.amount AS "reservedAmount", r.created_at AS "reservedAt",
        CASE WHEN r.created_at IS NOT NULL
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - r.created_at))))::int
          ELSE NULL
        END AS "reservationAgeSeconds",
       j.created_at AS "createdAt", j.updated_at AS "updatedAt",
       j.resolution_outcome AS "resolutionOutcome", j.resolution_by AS "resolutionBy",
       j.resolution_reason AS "resolutionReason", j.resolved_at AS "resolvedAt"
     FROM meduha_generation_jobs j
     LEFT JOIN meduha_credit_reservations r ON r.id = j.reservation_id
     WHERE j.status IN ('submitting', 'unknown', 'in_progress', 'finalizing')
     ORDER BY j.updated_at ASC, j.created_at ASC
     LIMIT 100`,
  );
  res.json({ items: rows });
});

router.post('/admin/generations/seedance/:jobId/check', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const jobId = pathParam(req, 'jobId');
  const { rows } = await pool.query(
    `SELECT id, request_id AS "requestId", status
     FROM meduha_generation_jobs WHERE id = $1`,
    [jobId],
  );
  const job = rows[0] as { id: string; requestId: string | null; status: string } | undefined;
  if (!job) { error(res, 404, 'GENERATION_NOT_FOUND', 'Запрос генерации не найден.'); return; }
  if (!job.requestId || !['unknown', 'in_progress'].includes(job.status)) {
    error(res, 409, 'GENERATION_NOT_CHECKABLE', 'У этого запроса нет доступного ID провайдера или он уже разрешён.'); return;
  }
  let result: Awaited<ReturnType<typeof getHiggsfieldRequestStatus>>;
  try {
    result = await providerStatusFetcher(job.requestId);
  } catch {
    error(res, 502, 'PROVIDER_CHECK_FAILED', 'Не удалось подтвердить состояние в Higgsfield. Резерв не изменён.'); return;
  }
  await audit(actor, 'generation.provider.check', 'generation', job.id, {
    providerStatus: result.status, requestId: job.requestId,
  });
  const applied = await applyGenerationProviderStatus(job.id, result, storeGenerationVideoForTest);
  if (!applied) { error(res, 409, 'GENERATION_CHANGED', 'Состояние запроса изменилось во время проверки. Обнови список.'); return; }
  res.json({ jobId: job.id, providerStatus: result.status });
});

router.post('/admin/generations/seedance/:jobId/resolve', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const outcome = req.body?.outcome;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['completed', 'failed'].includes(outcome) || reason.length < 10 || reason.length > 1000) {
    error(res, 400, 'INVALID_INPUT', 'Выбери подтверждённый исход и укажи причину длиной от 10 до 1000 символов.'); return;
  }
  const jobId = pathParam(req, 'jobId');
  const client = await pool.connect();
  let replay = false;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT j.id, j.status, j.request_id, j.resolution_outcome, j.resolution_by,
         j.resolution_reason, r.status AS reservation_status
       FROM meduha_generation_jobs j
       JOIN meduha_credit_reservations r ON r.id = j.reservation_id
       WHERE j.id = $1
       FOR UPDATE OF j, r`,
      [jobId],
    );
    const job = rows[0] as {
      id: string; status: string; request_id: string | null; resolution_outcome: string | null;
      resolution_by: string | null; resolution_reason: string | null; reservation_status: string;
    } | undefined;
    if (!job) {
      await client.query('ROLLBACK');
      error(res, 404, 'GENERATION_NOT_FOUND', 'Запрос генерации или его резерв не найден.'); return;
    }
    const sameResolution = job.resolution_outcome === outcome && job.resolution_by === actor
      && job.resolution_reason === reason;
    if (sameResolution && ['finalizing', 'completed', 'failed'].includes(job.status)) {
      replay = true;
    } else if (job.status !== 'unknown' || job.request_id !== null || job.resolution_outcome !== null
      || job.reservation_status !== 'held') {
      await client.query('ROLLBACK');
      error(res, 409, 'GENERATION_NOT_RESOLVABLE', 'Разрешить вручную можно только неопределённый запрос без ID провайдера и с удержанным резервом.'); return;
    } else {
      await client.query(
        `UPDATE meduha_generation_jobs
         SET status = 'finalizing', provider_status = $2, resolution_outcome = $2,
             resolution_by = $3, resolution_reason = $4, resolved_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [job.id, outcome, actor, reason],
      );
      await client.query(
        `INSERT INTO meduha_admin_audit (actor_id, action, entity_type, entity_id, details)
         VALUES ($1, 'generation.manual.resolve', 'generation', $2, $3::jsonb)`,
        [actor, job.id, JSON.stringify({ outcome, reason, requestId: null })],
      );
    }
    await client.query('COMMIT');
  } catch (caught) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw caught;
  } finally {
    client.release();
  }
  await finalizeResolvedGeneration(jobId);
  res.json({ jobId, outcome, replayed: replay });
});

router.get('/admin/users', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminUsersQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры списка пользователей.'); return; }
  const { query, limit, offset } = params.data;
  const search = query?.trim();
  const filter = search ? or(
    ilike(meduhaAccounts.id, `%${search}%`),
    ilike(meduhaAccounts.firstName, `%${search}%`),
    ilike(meduhaAccounts.lastName, `%${search}%`),
    ilike(meduhaAccounts.username, `%${search}%`),
  ) : undefined;
  const [users, totals] = await Promise.all([
    db.select({
      id: meduhaAccounts.id, firstName: meduhaAccounts.firstName, lastName: meduhaAccounts.lastName,
      username: meduhaAccounts.username, photoUrl: meduhaAccounts.photoUrl, credits: meduhaAccounts.credits,
      subscription: meduhaAccounts.subscription, blocked: meduhaAccounts.blocked,
      createdAt: meduhaAccounts.createdAt,
    }).from(meduhaAccounts).where(filter).orderBy(desc(meduhaAccounts.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(meduhaAccounts).where(filter),
  ]);
  res.json(ListAdminUsersResponse.parse({ items: users, total: totals[0].total, limit, offset }));
});
router.get('/admin/users/:userId', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const [account] = await db.select({
    id: meduhaAccounts.id, firstName: meduhaAccounts.firstName, lastName: meduhaAccounts.lastName,
    username: meduhaAccounts.username, photoUrl: meduhaAccounts.photoUrl, languageCode: meduhaAccounts.languageCode,
    credits: meduhaAccounts.credits, subscription: meduhaAccounts.subscription,
    blocked: meduhaAccounts.blocked, createdAt: meduhaAccounts.createdAt,
  }).from(meduhaAccounts).where(eq(meduhaAccounts.id, pathParam(req, 'userId'))).limit(1);
  if (!account) { error(res, 404, 'NOT_FOUND', 'Пользователь не найден.'); return; }
  const [works, wallet] = await Promise.all([
    db.select().from(meduhaWorks).where(eq(meduhaWorks.userId, account.id)).orderBy(desc(meduhaWorks.createdAt)),
    getWallet(account.id, 20, 0),
  ]);
  res.json(GetAdminUserResponse.parse({ ...account, wallet, works }));
});
router.get('/admin/wallet', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  if (typeof req.query.userId !== 'string' || !req.query.userId.trim()) {
    error(res, 400, 'INVALID_INPUT', 'Укажи ID пользователя для кошелька.'); return;
  }
  const params = GetAdminWalletQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры кошелька.'); return; }
  const [account] = await db.select({ id: meduhaAccounts.id }).from(meduhaAccounts)
    .where(eq(meduhaAccounts.id, params.data.userId)).limit(1);
  if (!account) { error(res, 404, 'NOT_FOUND', 'Пользователь не найден.'); return; }
  const wallet = await getWallet(account.id, params.data.limit, params.data.offset);
  res.json(GetAdminWalletResponse.parse(wallet));
});
router.put('/admin/users/:userId/block', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = SetAdminUserBlockedBody.safeParse(req.body);
  if (!body.success) { error(res, 400, 'INVALID_INPUT', 'Некорректный статус блокировки.'); return; }
  const target = pathParam(req, 'userId');
  const designated = isDesignatedAdmin === isTemplateAdmin ? await designatedAdminId() : actor;
  if (body.data.blocked && (target === actor || target === designated)) {
    error(res, 403, 'PROTECTED_ACCOUNT', 'Нельзя заблокировать администратора или собственную учётную запись.'); return;
  }
  const [row] = await db.update(meduhaAccounts).set({ blocked: body.data.blocked, updatedAt: new Date() })
    .where(eq(meduhaAccounts.id, target)).returning({ id: meduhaAccounts.id, blocked: meduhaAccounts.blocked });
  if (!row) { error(res, 404, 'NOT_FOUND', 'Пользователь не найден.'); return; }
  await audit(actor, body.data.blocked ? 'user.block' : 'user.unblock', 'account', row.id);
  res.json(SetAdminUserBlockedResponse.parse(row));
});

router.get('/admin/statistics', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const [finance, templates, publishedTemplates, works] = await Promise.all([
    getFinanceStats(),
    db.select({ total: count() }).from(meduhaTemplates),
    db.select({ total: count() }).from(meduhaTemplates).where(eq(meduhaTemplates.status, 'published')),
    db.select({ total: count() }).from(meduhaWorks),
  ]);
  res.json(GetAdminStatisticsResponse.parse({
    ...finance,
    templates: templates[0].total,
    publishedTemplates: publishedTemplates[0].total,
    works: works[0].total,
  }));
});
router.get('/admin/templates', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminTemplatesQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры списка шаблонов.'); return; }
  res.json(ListAdminTemplatesResponse.parse(await db.select().from(meduhaTemplates)
    .orderBy(desc(meduhaTemplates.updatedAt), desc(meduhaTemplates.id)).limit(params.data.limit).offset(params.data.offset)));
});
router.patch('/admin/templates/:templateId/publication', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = ModerateAdminTemplateBody.safeParse(req.body);
  if (!body.success) { error(res, 400, 'INVALID_INPUT', 'Некорректный статус публикации.'); return; }
  const [row] = await db.update(meduhaTemplates).set({ status: body.data.status, updatedAt: new Date() })
    .where(eq(meduhaTemplates.id, pathParam(req, 'templateId'))).returning();
  if (!row) { error(res, 404, 'NOT_FOUND', 'Шаблон не найден.'); return; }
  await audit(actor, 'template.moderate', 'template', row.id);
  res.json(ModerateAdminTemplateResponse.parse(row));
});
router.get('/admin/reports', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminReportsQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры списка жалоб.'); return; }
  res.json(ListAdminReportsResponse.parse(await db.select().from(meduhaReports)
    .orderBy(desc(meduhaReports.createdAt), desc(meduhaReports.id)).limit(params.data.limit).offset(params.data.offset)));
});
router.patch('/admin/reports/:reportId', async (req, res): Promise<void> => {
  const actor = await requiredAdmin(req, res); if (!actor) return;
  const body = ResolveAdminReportBody.safeParse(req.body);
  if (!body.success) { error(res, 400, 'INVALID_INPUT', 'Некорректное решение по жалобе.'); return; }
  const [row] = await db.update(meduhaReports).set({
    status: body.data.status, resolvedBy: actor, resolvedAt: new Date(),
  }).where(eq(meduhaReports.id, pathParam(req, 'reportId'))).returning();
  if (!row) { error(res, 404, 'NOT_FOUND', 'Жалоба не найдена.'); return; }
  await audit(actor, `report.${body.data.status}`, 'report', row.id);
  res.json(ResolveAdminReportResponse.parse(row));
});
router.get('/admin/jobs', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminJobsQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры списка работ.'); return; }
  res.json(ListAdminJobsResponse.parse(await db.select({
    id: meduhaWorks.id, userId: meduhaWorks.userId, title: meduhaWorks.title,
    type: meduhaWorks.type, status: meduhaWorks.status, createdAt: meduhaWorks.createdAt,
  }).from(meduhaWorks).orderBy(desc(meduhaWorks.createdAt), desc(meduhaWorks.id))
    .limit(params.data.limit).offset(params.data.offset)));
});
router.get('/admin/audit', async (req, res): Promise<void> => {
  if (!await requiredAdmin(req, res)) return;
  const params = ListAdminAuditQueryParams.safeParse(req.query);
  if (!params.success) { error(res, 400, 'INVALID_INPUT', 'Некорректные параметры аудита.'); return; }
  const { limit, offset } = params.data;
  const [items, totals] = await Promise.all([
    db.select().from(meduhaAdminAudit).orderBy(desc(meduhaAdminAudit.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(meduhaAdminAudit),
  ]);
  res.json(ListAdminAuditResponse.parse({
    items: items.map(item => item.entityType === 'admin-session' ? { ...item, entityId: null } : item),
    total: totals[0].total, limit, offset,
  }));
});

function validHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}

function validSecretRef(value: string | null | undefined): boolean {
  return value === undefined || value === null || /^secret:\/\/[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value);
}

router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, 'Admin request failed');
  if (!res.headersSent) error(res, 503, 'ADMIN_SERVICE_UNAVAILABLE', 'Не удалось выполнить запрос администратора.');
});

return router;
}
