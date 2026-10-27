import { isIP } from 'node:net';
import { SaveAdminStudioContentBody } from '@workspace/api-zod';
import { pool } from '@workspace/db';
import { objectStorageClient } from './objectStorage';

export const CONTENT_KEY = /^(photo-idea|video-scenario|photo-example):[a-zA-Z0-9][a-zA-Z0-9./:_-]{0,199}$/;
export const CONTENT_MEDIA_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const MAX_CONTENT_IMAGE = 2 * 1024 * 1024;
const localMedia = /^\/api\/meduha\/studio-content-media\/([a-f0-9-]{36})$/;

export function safeStudioCover(cover: string | null): boolean {
  if (cover === null) return true;
  if (localMedia.test(cover)) return true;
  if (/^\/api\/meduha\/example-media\/[a-zA-Z0-9._-]+$/.test(cover)) return true;
  if (/^\/images\/[a-zA-Z0-9/_-]+\.(webp|png|jpe?g)$/.test(cover)) return true;
  try {
    const url = new URL(cover);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && (!url.port || url.port === '443') && !isIP(url.hostname)
      && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)
      && !/\.(localhost|local|internal|test|invalid)$/i.test(url.hostname);
  } catch { return false; }
}

export function parseStudioContent(key: string, input: unknown) {
  if (!CONTENT_KEY.test(key)) return null;
  const parsed = SaveAdminStudioContentBody.strict().safeParse(input);
  if (!parsed.success) return null;
  const data = { ...parsed.data, title: parsed.data.title.trim(), description: parsed.data.description.trim() };
  if (!data.title || !safeStudioCover(data.cover) || !Number.isSafeInteger(data.revision) || data.revision > 2147483646) return null;
  return data;
}

export function validateStudioImage(type: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_CONTENT_IMAGE) return false;
  if (type === 'image/png') return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  return false;
}

export function studioContentFile(id: string) {
  if (!CONTENT_MEDIA_ID.test(id)) throw new Error('Invalid content media ID');
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucket, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  return objectStorageClient.bucket(bucket).file(`${prefix.join('/')}/studio-content/${id}`);
}

export async function listStudioContent() {
  const { rows } = await pool.query(`SELECT key,title,description,cover,enabled,revision,updated_at AS "updatedAt"
    FROM meduha_studio_content ORDER BY key`);
  return rows.map(row => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() }));
}

export async function saveStudioContent(key: string, data: NonNullable<ReturnType<typeof parseStudioContent>>, actor: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const media = data.cover?.match(localMedia)?.[1];
    if (media && !(await client.query('SELECT id FROM meduha_studio_content_media WHERE id=$1', [media])).rowCount) {
      await client.query('ROLLBACK');
      return { status: 400 as const, code: 'CONTENT_MEDIA_NOT_FOUND' };
    }
    // revision 0 only creates a new override. Existing entries can never be
    // overwritten using a stale form or a duplicate first-save request.
    const result = data.revision === 0
      ? await client.query(`INSERT INTO meduha_studio_content(key,title,description,cover,enabled,revision)
          VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(key) DO NOTHING
          RETURNING key,title,description,cover,enabled,revision,updated_at AS "updatedAt"`,
        [key,data.title,data.description,data.cover,data.enabled])
      : await client.query(`UPDATE meduha_studio_content SET title=$2,description=$3,cover=$4,enabled=$5,
          revision=revision+1,updated_at=now() WHERE key=$1 AND revision=$6
          RETURNING key,title,description,cover,enabled,revision,updated_at AS "updatedAt"`,
        [key,data.title,data.description,data.cover,data.enabled,data.revision]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return { status: 409 as const, code: 'CONTENT_REVISION_CONFLICT' };
    }
    await client.query(`INSERT INTO meduha_admin_audit(actor_id,action,entity_type,entity_id,details)
      VALUES($1,'studio-content.update','studio-content',$2,$3)`, [actor,key,JSON.stringify({ enabled:data.enabled, revision:result.rows[0].revision })]);
    await client.query('COMMIT');
    return { status: 200 as const, item: { ...result.rows[0], updatedAt:new Date(result.rows[0].updatedAt).toISOString() } };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
