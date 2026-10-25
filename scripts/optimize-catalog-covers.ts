/**
 * Preserve byte-identical originals and publish content-addressed WebP sizes.
 * Only curated, verified example images are imported, never private user media.
 * Run: pnpm --filter @workspace/scripts exec tsx optimize-catalog-covers.ts
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/meduha/src/meduha/cover-media.json');
type Asset = { id: string; size: number; width: number; height: number; contentType: string };
const assets: Record<string, Asset> = {};
const covers: Record<string, { original: string; thumb: string; card: string; hero: string }> = {};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let originalBytes = 0, cardBytes = 0, heroBytes = 0, thumbBytes = 0;

async function store(bytes: Buffer, width: number, height: number) {
  const name = `cover-${sha(bytes)}.webp`;
  const id = `catalog-covers/${name}`;
  const file = templateFile(id);
  const [exists] = await file.exists();
  if (exists) {
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== bytes.length) throw new Error('Stored cover integrity mismatch');
  } else {
    await file.save(bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: { contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable' },
    });
  }
  assets[name] = { id, size: bytes.length, width, height, contentType: 'image/webp' };
  return name;
}

async function optimize(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(
    (parsed.hostname === 'd28lhcrx5qdowv.cloudfront.net' && parsed.pathname.startsWith('/media/explore/media/'))
    || (parsed.hostname === 'static.higgsfield.ai' && parsed.pathname.startsWith('/api-workflows/'))
  )) throw new Error('Unapproved cover source');
  const response = await fetch(url, {
    redirect: 'error', headers: { 'User-Agent': 'Meduha-Preview-Catalog/1.0' }, signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Cover source returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Cover exceeds import size limit');
  const dir = await mkdtemp(path.join(tmpdir(), 'meduha-cover-'));
  try {
    const input = path.join(dir, 'original.webp');
    await writeFile(input, bytes);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', input]);
    const { width, height } = JSON.parse(stdout).streams[0];
    if (!(width > 0 && height > 0)) throw new Error('Invalid source dimensions');
    const original = await store(bytes, width, height);
    originalBytes += bytes.length;
    const variants: Record<string, string> = {};
    for (const [role, target] of [['thumb', 96], ['card', 400], ['hero', 800]] as const) {
      const encoded = path.join(dir, `${role}.webp`);
      const actualWidth = Math.min(width, target);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-map_metadata', '-1', '-vf', `scale=${actualWidth}:-1`,
        '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '78', '-compression_level', '6', '-threads', '1', encoded], { timeout: 30_000 });
      const data = await readFile(encoded);
      variants[role] = await store(data, actualWidth, Math.round(height * actualWidth / width));
      if (role === 'card') cardBytes += data.length;
      if (role === 'hero') heroBytes += data.length;
      if (role === 'thumb') thumbBytes += data.length;
    }
    covers[url] = { original, thumb: variants.thumb, card: variants.card, hero: variants.hero };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const urls = new Set<string>();
for (const kind of ['photo', 'video']) {
  const manifest = JSON.parse(await readFile(path.join(root, `artifacts/meduha/src/meduha/${kind}/model-preview-media.json`), 'utf8'));
  for (const item of Object.values(manifest.models) as { image?: string; thumb?: string }[]) {
    const source = kind === 'photo' ? item.image : item.thumb;
    if (source) urls.add(source);
  }
}
const queue = [...urls].sort();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) await optimize(queue.shift()!);
}));
await writeFile(output, `${JSON.stringify({
  version: 1,
  covers: Object.fromEntries(Object.entries(covers).sort(([a], [b]) => a.localeCompare(b))),
  assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))),
}, null, 2)}\n`);
console.log(JSON.stringify({ sources: urls.size, storedAssets: Object.keys(assets).length, originalBytes, thumbBytes, cardBytes, heroBytes }));
