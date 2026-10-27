import { pool } from '@workspace/db';
import { eligibleContactSql, sendBroadcastMessage } from './broadcasts';
import { TelegramApiError } from './telegram-api';

/** Telegram has no send idempotency key: uncertain sends must never be automatically repeated. */
export function deliveryFailure(error: unknown, attempts: number) {
  if (error instanceof TelegramApiError && error.status === 429 && attempts < 5) {
    return { status: 'pending', delay: Math.max(1, Math.min(86400, error.retryAfter)), code: '429' };
  }
  if (error instanceof TelegramApiError && error.status >= 400 && error.status < 500) {
    return { status: 'failed', delay: 0, code: String(error.status) };
  }
  return { status: 'unknown', delay: 0, code: 'DELIVERY_UNCERTAIN' };
}
export async function processBroadcastDelivery(send = sendBroadcastMessage) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('meduha-broadcast')) AS locked");
    locked = lock.rows[0].locked;
    if (!locked) return;
    // The session lock proves no previous sender is still active. Never replay an interrupted send.
    await client.query("UPDATE meduha_broadcast_deliveries SET status='unknown',error_code='INTERRUPTED' WHERE status='sending'");
    const { rows: [row] } = await client.query(`SELECT d.id delivery_id,d.contact_id,d.attempts,b.*,m.kind media_kind,
      (${eligibleContactSql}) eligible FROM meduha_broadcast_deliveries d
      JOIN meduha_broadcasts b ON b.id=d.campaign_id
      JOIN meduha_bot_contacts c ON c.id=d.contact_id
      LEFT JOIN meduha_accounts a ON a.id=c.id LEFT JOIN meduha_broadcast_media m ON m.id=b.media_id
      WHERE d.status='pending' AND b.status='queued' AND d.next_at<=now() ORDER BY d.next_at,d.id LIMIT 1`);
    if (!row) {
      await client.query(`UPDATE meduha_broadcasts b SET status='completed' WHERE status='queued'
        AND NOT EXISTS(SELECT 1 FROM meduha_broadcast_deliveries d WHERE d.campaign_id=b.id AND d.status IN ('pending','sending'))`);
      return;
    }
    if (!row.eligible) {
      await client.query("UPDATE meduha_broadcast_deliveries SET status='skipped',error_code='UNSUBSCRIBED_OR_BLOCKED' WHERE id=$1", [row.delivery_id]);
      return;
    }
    await client.query("UPDATE meduha_broadcast_deliveries SET status='sending',attempts=attempts+1 WHERE id=$1", [row.delivery_id]);
    try {
      const result = await send(row, row.contact_id);
      await client.query("UPDATE meduha_broadcast_deliveries SET status='sent',telegram_message_id=$2,error_code=null WHERE id=$1", [row.delivery_id,String(result.message_id)]);
    } catch (error) {
      const failure = deliveryFailure(error, row.attempts + 1);
      if (failure.code === '403') await client.query("UPDATE meduha_bot_contacts SET reachable=false,updated_at=now() WHERE id=$1", [row.contact_id]);
      // Persist 429 cooldown globally so other recipients do not immediately hit the same bot limit.
      if (failure.code === '429') await client.query("UPDATE meduha_broadcast_deliveries SET next_at=greatest(next_at,now()+$1*interval '1 second') WHERE status='pending'", [failure.delay || 5]);
      await client.query("UPDATE meduha_broadcast_deliveries SET status=$2,error_code=$3,next_at=now()+$4*interval '1 second' WHERE id=$1", [row.delivery_id,failure.status,failure.code,failure.delay]);
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('meduha-broadcast'))").catch(() => {});
    client.release();
  }
}
export function startBroadcastWorker() {
  const logger = import('./logger').then(module => module.logger);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try { await processBroadcastDelivery(); }
    catch { (await logger).warn({ code:'BROADCAST_WORKER_RETRY' }, 'Broadcast worker will retry'); }
    if (!stopped) { timer = setTimeout(tick, 1100); timer.unref(); }
  };
  timer = setTimeout(tick, 5000); timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
