import { createHash } from 'node:crypto';

let cached: { fingerprint: string; username: string | null; expiresAt: number } | undefined;
let pending: { fingerprint: string; request: Promise<string | null> } | undefined;

/** Public metadata only. Never expose the bot credential or log a Bot API URL. */
export async function resolveTelegramBotUsername(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const fingerprint = createHash('sha256').update(token).digest('hex');
  if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) return cached.username;
  if (pending?.fingerprint === fingerprint) return pending.request;
  const request = (async () => {
    let username: string | null = null;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        method: 'POST', signal: AbortSignal.timeout(4000),
      });
      const data = await response.json() as { ok?: boolean; result?: { is_bot?: boolean; username?: string } };
      const value = data.result?.username;
      if (response.ok && data.ok && data.result?.is_bot && typeof value === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(value)) username = value;
    } catch {
      // A metadata outage must not become an auth bypass or break account data.
    }
    cached = { fingerprint, username, expiresAt: Date.now() + (username ? 300_000 : 15_000) };
    return username;
  })();
  pending = { fingerprint, request };
  try { return await request; }
  finally { if (pending?.request === request) pending = undefined; }
}
