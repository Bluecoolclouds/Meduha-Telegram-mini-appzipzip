// Explicitly approved public example. Bytes live in App Storage, never in Git.
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';
import { motionAssets } from '../artifacts/api-server/src/lib/motion-example';
const poster = '/tmp/meduha-motion-poster.jpg';
execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', 'attached_assets/generation_1792812120247.mp4',
  '-frames:v', '1', '-vf', 'scale=360:-1', '-y', poster]);
const paths: Record<keyof typeof motionAssets, string> = {
  'motion-result.mp4': 'attached_assets/generation_1792812120247.mp4',
  'motion-poster.jpg': poster,
  'motion-reference.mp4': 'attached_assets/референс_1792812240641.mp4',
  'motion-image-1.webp': 'attached_assets/image_(1)_1792812273777.webp',
  'motion-image-2.webp': 'attached_assets/image_1792812275075.webp',
};
for (const [name, asset] of Object.entries(motionAssets)) {
  const path = paths[name as keyof typeof paths], size = (await stat(path)).size;
  if (asset.size && size !== asset.size) throw new Error(`Unexpected size for ${name}`);
  const file = templateFile(asset.id);
  if ((await file.exists())[0]) {
    const [meta] = await file.getMetadata();
    if (Number(meta.size) !== size || meta.contentType !== asset.contentType) throw new Error(`Existing asset differs: ${name}`);
  } else {
    await file.save(await readFile(path), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: asset.contentType, cacheControl: 'private,no-cache' } });
  }
  console.log(`Stored ${name} (${size} bytes)`);
}
