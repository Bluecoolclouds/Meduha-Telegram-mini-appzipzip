import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '@workspace/db';

// Never a Telegram account ID. Finance/audit actor IDs are opaque text, not FKs.
export const TEMPORARY_ADMIN_ACTOR = 'temporary:admin';
export const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_ATTEMPT_LIMIT = 10;

export function temporaryAdminConfig(env: NodeJS.ProcessEnv = process.env) {
  const login = env.MEDUHA_ADMIN_LOGIN;
  const password = env.MEDUHA_ADMIN_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;
  if (login !== 'admin' || !password || !sessionSecret) return null;
  const fingerprint = createHmac('sha256', sessionSecret)
    .update(JSON.stringify(['meduha-temporary-admin-v1', login, password])).digest('hex');
  return { login, password, fingerprint };
}

function equalSecret(left: string, right: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

export function validTemporaryCredentials(config: ReturnType<typeof temporaryAdminConfig>, login: string, password: string) {
  // Fixed-length digests avoid length-dependent timingSafeEqual exceptions.
  const loginMatches = equalSecret(login, config?.login ?? '');
  const passwordMatches = equalSecret(password, config?.password ?? '');
  return !!config && loginMatches && passwordMatches;
}

/** Atomic, shared rate limit. Counts all attempts, including successful ones. */
export async function allowPasswordAttempt(ip: string): Promise<boolean> {
  const key = `password:${createHash('sha256').update(ip).digest('hex')}`;
  const { rows } = await pool.query<{ attempts: number }>(
    `INSERT INTO meduha_admin_login_attempts (key, attempts, expires_at)
     VALUES ($1, 1, clock_timestamp() + ($2 * interval '1 millisecond'))
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN meduha_admin_login_attempts.expires_at <= clock_timestamp()
         THEN 1 ELSE meduha_admin_login_attempts.attempts + 1 END,
       expires_at = CASE WHEN meduha_admin_login_attempts.expires_at <= clock_timestamp()
         THEN EXCLUDED.expires_at ELSE meduha_admin_login_attempts.expires_at END
     RETURNING attempts`,
    [key, PASSWORD_ATTEMPT_WINDOW_MS],
  );
  return rows[0].attempts <= PASSWORD_ATTEMPT_LIMIT;
}
