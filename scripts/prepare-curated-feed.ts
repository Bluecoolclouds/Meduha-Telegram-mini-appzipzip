/**
 * Run manually when changing approved examples/encoder settings, never on the
 * request path. Stores only derivatives; does not rewrite original media.
 * pnpm --filter @workspace/scripts run prepare:curated-feed
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curatedExampleIds, sourceFor } from '../artifacts/api-server/src/routes/feed-media';
import { createFeedVariant, variantFile, type FeedVariant } from '../artifacts/api-server/src/lib/feed-media';
import type { CuratedAsset } from '../artifacts/api-server/src/lib/curated-feed';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';

const output = fileURLToPath(new URL('../lib/studio-examples/feed-media.json', import.meta.url));
// Resolve local starter images exactly as the API workflow does.
process.chdir(fileURLToPath(new URL('../artifacts/api-server/', import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'curated-feed-'));
try {
  const manifest: Record<string, Partial<Record<FeedVariant, CuratedAsset>>> = {};
  for (const id of curatedExampleIds) {
    manifest[id] = {};
    for (const variant of ['thumb', 'preview'] as const) {
      const source = await sourceFor(id, variant);
      if (!source) {
        if (variant === 'thumb') throw new Error(`Missing approved poster: ${id}`);
        continue;
      }
      await createFeedVariant(source, variant);
      const [bytes] = await variantFile(source, variant).download();
      if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Invalid derivative size');
      const local = join(directory, `${variant}.${variant === 'thumb' ? 'webp' : 'mp4'}`);
      await writeFile(local, bytes);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', local], { encoding: 'utf8' }));
      if (probe.streams.length !== 1 || probe.streams[0].width > 480 || probe.streams[0].height > 480
        || probe.streams[0].codec_name !== (variant === 'thumb' ? 'webp' : 'h264')
        || (variant === 'preview' && Number(probe.format.duration) > 6.1)) throw new Error('Invalid curated encoding');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const object = `curated-feed/v1/${sha256}.${variant === 'thumb' ? 'webp' : 'mp4'}`;
      const file = templateFile(object);
      try {
        await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: variant === 'thumb' ? 'image/webp' : 'video/mp4', cacheControl: 'private, no-cache' } });
      } catch (error) { if ((error as { code?: number }).code !== 412) throw error; }
      const [stored] = await file.download();
      if (!stored.equals(bytes)) throw new Error('Stored curated derivative differs');
      const [metadata] = await file.getMetadata();
      manifest[id][variant] = { object, generation: String(metadata.generation), size: bytes.length, sha256 };
      process.stdout.write(`${id}/${variant}: ${bytes.length} bytes, ${probe.streams[0].width}x${probe.streams[0].height}\n`);
    }
  }
  // Atomic from the caller's perspective: only replace after all assets pass.
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Prepared ${Object.keys(manifest).length} approved examples.\n`);
} finally { await rm(directory, { recursive: true, force: true }); }
