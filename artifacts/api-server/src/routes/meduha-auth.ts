import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { eq, and, gt } from 'drizzle-orm';
import { db, meduhaAccounts, meduhaSessions, type MeduhaAccountRow } from '@workspace/db';

function sessionToken(req: Request) {
  const raw: unknown = req.cookies?.meduha_session;
  return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
export async function currentAccount(req: Request): Promise<MeduhaAccountRow | null> {
  const raw = sessionToken(req);
  if (!raw) return null;
  const tokenHash = createHash('sha256').update(raw).digest('hex');
  const [row] = await db.select({ account: meduhaAccounts }).from(meduhaSessions)
    .innerJoin(meduhaAccounts, eq(meduhaAccounts.id, meduhaSessions.userId))
    .where(and(eq(meduhaSessions.tokenHash, tokenHash), gt(meduhaSessions.expiresAt, new Date()))).limit(1);
  return row?.account ?? null;
}
export async function requireAccount(req: Request, res: Response) {
  const account = await currentAccount(req);
  if (!account) res.status(401).json({ code: 'SESSION_REQUIRED', error: 'Войди через Telegram, чтобы загрузить аккаунт.' });
  else if (account.blocked) {
    res.status(403).json({ code: 'ACCOUNT_BLOCKED', error: 'Доступ к аккаунту ограничен.' });
    return null;
  }
  return account;
}
