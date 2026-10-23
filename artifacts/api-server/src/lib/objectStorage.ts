import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Canonical Replit sidecar credentials. No service-account keys are stored here.
const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export const MAX_GENERATION_VIDEO_BYTES = 512 * 1024 * 1024;
export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

function location(id: string, staging = false) {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucketName, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  return { bucketName, objectName: `${prefix.join('/')}/templates/${staging ? 'staging/' : ''}${id}` };
}

function generationLocation(id: string, temporary = false) {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (!new RegExp(`^${uuid}(?:\\.tmp\\.${uuid})?$`, 'i').test(id)) {
    throw new Error('Invalid generation video identifier');
  }
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucketName, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  const objectName = `${prefix.join('/')}/generation-results/${id}${temporary ? '' : '.video'}`;
  return { bucketName, objectName };
}
export function templateFile(id: string, staging = false) {
  const { bucketName, objectName } = location(id, staging);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

export function generationVideoFile(id: string) {
  const { bucketName, objectName } = generationLocation(id);
  return objectStorageClient.bucket(bucketName).file(objectName);
}
export async function templateUploadUrl(id: string) {
  const { bucketName, objectName } = location(id, true);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: bucketName, object_name: objectName, method: 'PUT',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Unable to sign App Storage upload');
  const { signed_url } = await response.json() as { signed_url: string };
  return String(signed_url);
}

// Private, immutable inputs are exposed only to the provider for a limited time.
// Never put this URL in a public job response or a log.
export async function templateProviderUrl(id: string) {
  const { bucketName, objectName } = location(id);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: bucketName, object_name: objectName, method: 'GET',
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Unable to sign provider input');
  const { signed_url } = await response.json() as { signed_url?: string };
  if (!signed_url || new URL(signed_url).protocol !== 'https:') throw new Error('Invalid provider input URL');
  return signed_url;
}

export class GenerationVideoValidationError extends Error {}

async function fetchProviderVideo(rawUrl: string, fetcher: typeof fetch, resolveHost: HostResolver) {
  let url = await validateProviderUrl(rawUrl, resolveHost);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'video/mp4, video/webm', 'Accept-Encoding': 'identity' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await discardResponseBody(response);
      if (!location || redirects === 3) throw new GenerationVideoValidationError('Provider video has too many or invalid redirects');
      url = await validateProviderUrl(new URL(location, url).toString(), resolveHost);
      continue;
    }
    if (!response.ok || !response.body) {
      await discardResponseBody(response);
      if (response.status < 500 && response.status !== 429) {
        throw new GenerationVideoValidationError(`Provider video download was rejected with HTTP ${response.status}`);
      }
      throw new Error(`Provider video download failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!GENERATION_VIDEO_TYPES.has(contentType)) {
      await discardResponseBody(response);
      throw new GenerationVideoValidationError('Provider video has an unsupported MIME type');
    }
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {
      await discardResponseBody(response);
      throw new GenerationVideoValidationError('Provider video used an unsupported content encoding');
    }
    const rawLength = response.headers.get('content-length');
    const contentLength = rawLength === null ? null : Number(rawLength);
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_GENERATION_VIDEO_BYTES)) {
      await discardResponseBody(response);
      throw new GenerationVideoValidationError('Provider video size is invalid or exceeds the limit');
    }
    return { response, contentType, contentLength };
  }
  throw new Error('Provider video redirect limit exceeded');
}

async function validateStoredVideo(file: ReturnType<typeof generationVideoFile>, expectedType?: string) {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  const contentType = metadata.contentType?.toLowerCase();
  if (!Number.isSafeInteger(size) || size < 8 || size > MAX_GENERATION_VIDEO_BYTES
    || !contentType || !GENERATION_VIDEO_TYPES.has(contentType)
    || (expectedType && contentType !== expectedType)) {
    throw new GenerationVideoValidationError('Stored generation video failed metadata validation');
  }
  return { size, contentType };
}

const GENERATION_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

type HostResolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string }[]>;

function isPublicIp(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0));
  }
  // Only globally routable unicast IPv6 addresses are accepted. This also
  // excludes loopback, link-local, ULA, IPv4-mapped, and unspecified ranges.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !address.includes('%');
}

function validateVideoHeader(contentType: string, header: Buffer) {
  if (contentType === 'video/mp4') {
    if (header.length < 8 || header.toString('ascii', 4, 8) !== 'ftyp') {
      throw new GenerationVideoValidationError('Provider video does not match its MP4 content type');
    }
  } else if (contentType === 'video/webm') {
    if (header.length < 4 || header[0] !== 0x1a || header[1] !== 0x45 || header[2] !== 0xdf || header[3] !== 0xa3) {
      throw new GenerationVideoValidationError('Provider video does not match its WebM content type');
    }
  }
}

/**
 * Copies a provider-hosted result into a deterministic private object. Temporary
 * unique objects plus a create-only final copy make retries and competing workers safe.
 */
export async function storeGenerationVideo(
  id: string,
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
  resolveHost: HostResolver = resolvePublicHost,
) {
  const destination = generationVideoFile(id);
  const [alreadyStored] = await destination.exists();
  if (alreadyStored) return validateStoredVideo(destination);

  const { response, contentType, contentLength } = await fetchProviderVideo(sourceUrl, fetcher, resolveHost);
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucketName, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  const tempId = `${id}.tmp.${randomUUID()}`;
  const temp = objectStorageClient.bucket(bucketName).file(`${prefix.join('/')}/generation-results/${tempId}`);
  let byteCount = 0;
  let head = Buffer.alloc(0);
  let headerChecked = false;
  const validator = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteCount += chunk.length;
      if (byteCount > MAX_GENERATION_VIDEO_BYTES || (contentLength !== null && byteCount > contentLength)) {
        callback(new GenerationVideoValidationError('Provider video exceeded its declared or allowed size'));
        return;
      }
      if (!headerChecked) {
        head = Buffer.concat([head, chunk]).subarray(0, 16);
        if (head.length >= 8) {
          try {
            validateVideoHeader(contentType, head);
            headerChecked = true;
          } catch (error) { callback(error as Error); return; }
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!headerChecked || byteCount < 8 || (contentLength !== null && byteCount !== contentLength)) {
        callback(new GenerationVideoValidationError('Provider video was incomplete or had invalid contents'));
        return;
      }
      callback();
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      validator,
      temp.createWriteStream({
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType, cacheControl: 'private, no-store' },
      }),
      { signal: AbortSignal.timeout(180_000) },
    );
    await validateStoredVideo(temp, contentType);
    try {
      await temp.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 412 && code !== 409) throw error;
      await validateStoredVideo(destination, contentType);
    }
    return await validateStoredVideo(destination, contentType);
  } catch (error) {
    await discardResponseBody(response);
    throw error;
  } finally {
    await temp.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}

const resolvePublicHost: HostResolver = async (hostname, options) =>
  await lookup(hostname, options) as { address: string }[];

async function validateProviderUrl(rawUrl: string, resolveHost: HostResolver = resolvePublicHost): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new GenerationVideoValidationError('Provider returned an invalid video URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new GenerationVideoValidationError('Provider video URL is not an allowed HTTPS URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new GenerationVideoValidationError('Provider video URL is not publicly reachable');
  }
  const resolved = isIP(hostname) ? [{ address: hostname }] : await resolveHost(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(({ address }) => !isPublicIp(address))) {
    throw new GenerationVideoValidationError('Provider video URL is not publicly reachable');
  }
  return url;
}

async function discardResponseBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* It may already be locked or consumed. */ }
}
