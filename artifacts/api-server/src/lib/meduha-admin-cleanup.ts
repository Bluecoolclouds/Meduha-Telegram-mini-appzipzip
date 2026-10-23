import { pool } from '@workspace/db';

export const ADMIN_ACCESS_CLEANUP_BATCH_SIZE = 100;
export const ADMIN_ACCESS_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
export const USED_ADMIN_PAIRING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A two-key advisory lock keeps cleanup isolated from locks used elsewhere.
export const ADMIN_ACCESS_CLEANUP_LOCK = { namespace: 1296388932, key: 1095914051 };

type CleanupResult = {
  acquired: boolean;
  pairingsRemoved: number;
  sessionsRemoved: number;
};

/**
 * Delete only expired credentials, in bounded batches. The advisory transaction
 * lock coordinates API instances, while row locks avoid racing an in-progress
 * pairing redemption. All expiration comparisons use PostgreSQL's clock.
 */
export async function cleanupExpiredMeduhaAdminAccess(): Promise<CleanupResult> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS acquired',
      [ADMIN_ACCESS_CLEANUP_LOCK.namespace, ADMIN_ACCESS_CLEANUP_LOCK.key],
    );
    if (!lock.rows[0]?.acquired) {
      await client.query('COMMIT');
      transactionOpen = false;
      return { acquired: false, pairingsRemoved: 0, sessionsRemoved: 0 };
    }

    const pairings = await client.query(
      `WITH expired AS (
         SELECT code_hash
         FROM meduha_admin_pairings
         WHERE (consumed_at IS NULL AND expires_at <= clock_timestamp())
            OR (consumed_at IS NOT NULL
                AND consumed_at <= clock_timestamp() - ($1::double precision * interval '1 millisecond'))
         ORDER BY COALESCE(consumed_at, expires_at), code_hash
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM meduha_admin_pairings AS pairing
       USING expired
       WHERE pairing.code_hash = expired.code_hash
       RETURNING pairing.code_hash`,
      [USED_ADMIN_PAIRING_RETENTION_MS, ADMIN_ACCESS_CLEANUP_BATCH_SIZE],
    );
    const sessions = await client.query(
      `WITH expired AS (
         SELECT token_hash
         FROM meduha_admin_sessions
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at, token_hash
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM meduha_admin_sessions AS session
       USING expired
       WHERE session.token_hash = expired.token_hash
       RETURNING session.token_hash`,
      [ADMIN_ACCESS_CLEANUP_BATCH_SIZE],
    );

    await client.query('COMMIT');
    transactionOpen = false;
    return {
      acquired: true,
      pairingsRemoved: pairings.rowCount ?? 0,
      sessionsRemoved: sessions.rowCount ?? 0,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
