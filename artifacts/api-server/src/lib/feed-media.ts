import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { templateFile, validateProviderUrl } from './objectStorage';

export type FeedVariant = 'thumb' | 'preview';
export type FeedSource = { key: string; objectId?: string; localPath?: string; url?: string; start?: number };
const run = promisify(execFile);
const MAX_SOURCE = 100 * 1024 * 1024;
// Bump this only when encoder settings change. Each source has one object per
// variant, not a new file for each view, server restart or concurrent request.
export const FEED_VERSION = 'v1';
export const variantKey = (source: FeedSource, variant: FeedVariant) =>
  createHash('sha256').update(`${FEED_VERSION}:${variant}:${source.key}:${source.start ?? 0}`).digest('hex');
export const variantFile = (source: FeedSource, variant: FeedVariant) =>
  templateFile(`feed-previews/${FEED_VERSION}/${variantKey(source, variant)}.${variant === 'thumb' ? 'webp' : 'mp4'}`);

export function encoderArgs(input: string, output: string, variant: FeedVariant, start = 0) {
  const scale = "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,jpeg_pipe,png_pipe,webp_pipe,gif',
    ...(start ? ['-ss', String(start)] : []), '-i', input, '-map', '0:v:0', '-an', '-sn', '-dn',
    ...(variant === 'thumb'
      ? ['-vf', scale, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '65']
      : ['-t', '6', '-vf', `${scale},fps=12`, '-c:v', 'libx264', '-threads', '1',
        '-preset', 'fast', '-crf', '32', '-maxrate', '300k', '-bufsize', '600k',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart']),
    output];
}

// Two small encoders per instance, bounded queue, single-flight per media.
let active = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<void>>();
const failedUntil = new Map<string, number>();
async function slot() {
  if (active >= 2) await new Promise<void>((resolve, reject) => {
    if (waiting.length >= 24) reject(new Error('Preview queue is busy'));
    else waiting.push(resolve);
  });
  else active++;
}
function release() {
  const next = waiting.shift();
  if (next) next(); // Transfer the occupied slot; do not let a newcomer steal it.
  else active--;
}

async function downloadRemote(raw: string, destination: string, variant: FeedVariant) {
  let url = await validateProviderUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(45_000),
      headers: { 'Accept-Encoding': 'identity' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error('Preview source redirect rejected');
      url = await validateProviderUrl(new URL(location, url).toString());
      continue;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !response.body || !/^(image|video)\//.test(type)
      || (variant === 'preview' && !type.startsWith('video/'))
      || Number(response.headers.get('content-length') ?? 0) > MAX_SOURCE) {
      await response.body?.cancel();
      throw new Error('Preview source is unavailable or too large');
    }
    let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_SOURCE ? new Error('Preview source exceeds size limit') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      limit, createWriteStream(destination), { signal: AbortSignal.timeout(60_000) });
    return;
  }
}

async function materialize(source: FeedSource, destination: string, variant: FeedVariant) {
  if (source.objectId) {
    const object = templateFile(source.objectId);
    const [meta] = await object.getMetadata();
    if (!Number(meta.size) || Number(meta.size) > MAX_SOURCE) throw new Error('Invalid preview source size');
    await pipeline(object.createReadStream(), createWriteStream(destination), { signal: AbortSignal.timeout(60_000) });
  } else if (source.localPath) {
    const info = await stat(source.localPath);
    if (!info.size || info.size > MAX_SOURCE) throw new Error('Invalid local preview source');
    await copyFile(source.localPath, destination);
  } else if (source.url) await downloadRemote(source.url, destination, variant);
  else throw new Error('Missing preview source');
}

export async function createFeedVariant(source: FeedSource, variant: FeedVariant) {
  const key = variantKey(source, variant);
  const current = inflight.get(key);
  if (current) return current;
  if ((failedUntil.get(key) ?? 0) > Date.now()) throw new Error('Preview preparation is cooling down');
  const task = (async () => {
    // App Storage is the durable cache; no process-local media cache or temp
    // copies survive processing. Immutable source pointers keep keys stable.
    const output = variantFile(source, variant);
    const [exists] = await output.exists();
    if (exists) return;
    await slot();
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'meduha-feed-'));
      const input = path.join(directory, 'source');
      const encoded = path.join(directory, variant === 'thumb' ? 'thumb.webp' : 'preview.mp4');
      await materialize(source, input, variant);
      await run('ffmpeg', encoderArgs(input, encoded, variant, source.start), { timeout: 90_000, maxBuffer: 64 * 1024 });
      const info = await stat(encoded);
      if (!info.size || info.size > (variant === 'thumb' ? 512 * 1024 : 1024 * 1024)) throw new Error('Invalid preview output size');
      try {
        await output.bucket.upload(encoded, {
          destination: output.name, resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: variant === 'thumb' ? 'image/webp' : 'video/mp4', cacheControl: 'private, no-cache' },
        });
      } catch (error) {
        // Another server may have finished the exact same deterministic variant.
        if ((error as { code?: number }).code !== 412) throw error;
      }
    } finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { release(); }
    }
  })();
  inflight.set(key, task);
  try { await task; failedUntil.delete(key); }
  catch (error) {
    if (failedUntil.size >= 256) failedUntil.delete(failedUntil.keys().next().value!);
    failedUntil.set(key, Date.now() + 60_000);
    throw error;
  } finally { inflight.delete(key); }
}
