import { pool, type PoolClient } from '@workspace/db';
import { randomUUID } from 'node:crypto';
import type { BroadcastButton, BroadcastContent } from './broadcast-content';
import { broadcastParameters } from './broadcast-content';
import { broadcastFile } from './broadcast-storage';
import { createTelegramApi, type TelegramApi } from './telegram-api';

export const eligibleContactSql = `c.subscribed=true AND c.reachable=true AND coalesce(a.blocked,false)=false AND coalesce(a.notifications,true)=true`;
export async function recordBotContact(id: string, subscribed?: boolean) {
  if (!/^[1-9]\d{0,15}$/.test(id)) return;
  await pool.query(`INSERT INTO meduha_bot_contacts(id,subscribed) VALUES($1,coalesce($2,false))
    ON CONFLICT(id) DO UPDATE SET reachable=true,subscribed=coalesce($2,meduha_bot_contacts.subscribed),updated_at=now()`, [id, subscribed ?? null]);
}
export async function listBroadcasts() {
  const { rows } = await pool.query(`SELECT b.*, m.kind AS media_kind,
    coalesce((SELECT jsonb_object_agg(t.status,t.n) FROM
      (SELECT status,count(*)::int AS n FROM meduha_broadcast_deliveries WHERE campaign_id=b.id GROUP BY status) t),'{}') counts
    FROM meduha_broadcasts b LEFT JOIN meduha_broadcast_media m ON m.id=b.media_id
    ORDER BY b.created_at DESC LIMIT 100`);
  return rows.map(broadcastView);
}
export function broadcastView(row: Record<string, any>) {
  return { id: row.id, title: row.title, text: row.text, mediaId: row.media_id ?? null,
    mediaKind: row.media_kind ?? null, buttons: row.buttons, status: row.status,
    testedAt: row.tested_at ? new Date(row.tested_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    counts: { pending: 0, sending: 0, sent: 0, failed: 0, unknown: 0, skipped: 0, canceled: 0, ...row.counts } };
}
export async function eligibleCount() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM meduha_bot_contacts c LEFT JOIN meduha_accounts a ON a.id=c.id WHERE ${eligibleContactSql}`);
  return rows[0].n as number;
}
export async function saveBroadcast(actor: string, content: BroadcastContent) {
  if (content.mediaId) {
    const media = await pool.query('SELECT id FROM meduha_broadcast_media WHERE id=$1', [content.mediaId]);
    if (!media.rowCount) throw new Error('Медиа не найдено. Загрузи файл повторно.');
  }
  const { rows } = await pool.query(`INSERT INTO meduha_broadcasts(id,actor_id,title,text,media_id,buttons)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(),actor,content.title,content.text,content.mediaId ?? null,JSON.stringify(content.buttons)]);
  return broadcastView(rows[0]);
}
export async function sendBroadcastMessage(row: Record<string, any>, chatId: string, api: TelegramApi = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? '')) {
  let media: string | Blob | undefined;
  if (row.media_id) {
    const { rows: [stored] } = await pool.query('SELECT * FROM meduha_broadcast_media WHERE id=$1', [row.media_id]);
    if (!stored) throw new Error('Media missing');
    if (stored.telegram_file_id) media = stored.telegram_file_id;
    else {
      const [bytes] = await broadcastFile(row.media_id).download();
      if (bytes.length !== stored.size || bytes.length > 50 * 1024 * 1024) throw new Error('Media integrity check failed');
      media = new Blob([new Uint8Array(bytes)],{type:stored.content_type});
    }
  }
  const result = await api(row.media_kind === 'photo' ? 'sendPhoto' : row.media_kind === 'video' ? 'sendVideo' : 'sendMessage',
    broadcastParameters(row.text, row.buttons as BroadcastButton[], chatId, row.media_kind ?? undefined, media)) as { message_id: number; photo?: {file_id:string}[]; video?: {file_id:string} };
  const fileId = result.video?.file_id ?? result.photo?.at(-1)?.file_id;
  // Telegram keeps an uploaded file. Reuse it for the whole audience rather than re-uploading per chat.
  if (row.media_id && fileId) await pool.query('UPDATE meduha_broadcast_media SET telegram_file_id=$2 WHERE id=$1',[row.media_id,fileId]);
  return result;
}
export async function broadcastAudit(client: PoolClient, actor: string, action: string, id: string, details = {}) {
  await client.query(`INSERT INTO meduha_admin_audit(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'broadcast',$3,$4)`,
    [actor,action,id,JSON.stringify(details)]);
}
