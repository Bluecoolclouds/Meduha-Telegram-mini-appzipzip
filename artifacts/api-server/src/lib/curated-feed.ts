import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import manifest from '@workspace/studio-examples/feed-media.json';
import { templateFile } from './objectStorage';
import { byteRange } from './feed-range';
import type { FeedVariant } from './feed-media';

export type CuratedAsset = { object: string; generation: string; size: number; sha256: string };
export const curatedManifest: Record<string, Partial<Record<FeedVariant, CuratedAsset>>> = manifest;
export function curatedAsset(id: string, variant: FeedVariant): CuratedAsset | undefined {
  return Object.hasOwn(curatedManifest, id) ? curatedManifest[id][variant] : undefined;
}

async function download(asset: CuratedAsset): Promise<Buffer> {
  const file = templateFile(asset.object);
  // Pin the immutable generation, not just a mutable object name. Read at most
  // size+1 bytes, so a corrupt manifest/object cannot cause an unbounded read.
  const [bytes] = await file.bucket.file(file.name, { generation: asset.generation })
    .download({ start: 0, end: asset.size });
  return bytes;
}

export function createCuratedReader(load = download) {
  // Only manifest-owned public bytes, never user media or access decisions.
  // The checked-in manifest bounds this cache (currently < 0.5 MB total).
  const pending = new Map<string, Promise<Buffer>>();
  return (asset: CuratedAsset): Promise<Buffer> => {
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 * 1024)
      return Promise.reject(new Error('Invalid curated asset size'));
    const key = `${asset.object}:${asset.generation}:${asset.sha256}:${asset.size}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const task = load(asset).then(bytes => {
      if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
        throw new Error('Curated asset integrity mismatch');
      return bytes;
    }).catch(error => { pending.delete(key); throw error; });
    pending.set(key, task);
    return task;
  };
}

const readCurated = createCuratedReader();
export async function serveCurated(req: Request, res: Response, asset: CuratedAsset, variant: FeedVariant,
  read = readCurated): Promise<void> {
  if (req.query.v !== undefined && req.query.v !== asset.sha256) {
    res.set('Cache-Control', 'no-store').sendStatus(404); return;
  }
  const etag = `"curated-${asset.sha256}"`;
  const versioned = req.query.v === asset.sha256;
  res.set({
    'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, no-cache',
    ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
  });
  const matches = req.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
  if (!req.headers.range && matches) { res.status(304).end(); return; }
  const requested = req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag) ? req.headers.range : undefined;
  const range = byteRange(requested, asset.size);
  if (!range) {
    res.status(416).set({ 'Content-Range': `bytes */${asset.size}`, 'Cache-Control': 'no-store' }).end(); return;
  }
  if (requested) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
  res.set({
    'Content-Type': variant === 'thumb' ? 'image/webp' : 'video/mp4',
    'Content-Length': String(range.end - range.start + 1),
  });
  if (req.method === 'HEAD') { res.end(); return; }
  // Finish this small bounded SDK read on disconnect; never destroy a GCS
  // stream during its initialization (see storage-stream-cancellation).
  const bytes = await read(asset);
  if (!res.destroyed) res.end(bytes.subarray(range.start, range.end + 1));
}
