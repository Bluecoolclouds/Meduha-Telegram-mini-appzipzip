import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { motionAssets } from '../artifacts/api-server/src/lib/motion-example';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const mediaDir = resolve(projectRoot, process.env.MOTION_EXAMPLE_MEDIA_DIR ?? 'attached_assets');
const posterPath = resolve(scriptDir, 'assets/motion-poster.jpg');

const sourceNames: Partial<Record<keyof typeof motionAssets, string[]>> = {
  'motion-result.mp4': ['motion-result.mp4', '0_generation_1792882899573.mp4'],
  'motion-reference.mp4': ['motion-reference.mp4', '0_ba45bee7-2a46-529f-8b1a-e85c8210e9a5_1792882907307.mp4'],
  'motion-image-1.webp': ['motion-image-1.webp', '0_image_(1)_1792882909846.webp'],
  'motion-image-2.webp': ['motion-image-2.webp', '0_image_1792882911763.webp'],
};
const approvedSha256: Record<keyof typeof motionAssets, string> = {
  'motion-result.mp4': 'da5cb9868aad5bebbd6fbba94e2faec3e9d3e31c9bbb3d55bd612c05b1961a94',
  'motion-poster.jpg': '187e9fd273a5d6cb99067fd16e504e363b1349e1d98ca6243ca9fb2533be5951',
  'motion-reference.mp4': '716b56c18c793967593921827796be22a77fceaded2cd5f440d12e90ad5aac65',
  'motion-image-1.webp': 'e17e76e23bb1aef56b805c4d8feb47d08a9fe3c51f6f0e4d4d1e34a47067eb75',
  'motion-image-2.webp': 'aac9d6eb2aaeabce51db6a351b3de32ed257405a460c60612e9612fd8e774108',
};

async function sourcePath(name: keyof typeof motionAssets): Promise<string> {
  if (name === 'motion-poster.jpg') return posterPath;
  for (const filename of sourceNames[name] ?? []) {
    const candidate = resolve(mediaDir, filename);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported filename.
    }
  }
  throw new Error(
    `Missing ${name}. Put the four approved source files in ${mediaDir} using their canonical names (motion-result.mp4, motion-reference.mp4, motion-image-1.webp, motion-image-2.webp).`,
  );
}

async function checksums(path: string): Promise<{ md5Base64: string; sha256Hex: string }> {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    md5.update(chunk);
    sha256.update(chunk);
  }
  return { md5Base64: md5.digest('base64'), sha256Hex: sha256.digest('hex') };
}

async function storedMd5Base64(file: ReturnType<typeof templateFile>): Promise<string> {
  const [metadata] = await file.getMetadata();
  if (metadata.md5Hash) return metadata.md5Hash;
  const hash = createHash('md5');
  for await (const chunk of file.createReadStream()) hash.update(chunk);
  return hash.digest('base64');
}

async function storedMatches(
  name: keyof typeof motionAssets,
  expectedMd5: string,
): Promise<boolean> {
  const asset = motionAssets[name];
  const file = templateFile(asset.id);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  const storedMd5 = await storedMd5Base64(file);
  return size === asset.size && metadata.contentType === asset.contentType && storedMd5 === expectedMd5;
}

async function writeAsset(
  name: keyof typeof motionAssets,
  path: string,
  generationMatch: number,
): Promise<void> {
  const asset = motionAssets[name];
  await pipeline(
    createReadStream(path),
    templateFile(asset.id).createWriteStream({
      resumable: false,
      preconditionOpts: { ifGenerationMatch: generationMatch },
      metadata: { contentType: asset.contentType, cacheControl: 'private,no-cache' },
    }),
  );
}

async function seed(): Promise<void> {
  const prepared: { name: keyof typeof motionAssets; path: string; size: number; md5Base64: string }[] = [];
  for (const name of Object.keys(motionAssets) as (keyof typeof motionAssets)[]) {
    const asset = motionAssets[name];
    const path = await sourcePath(name);
    const { size } = await stat(path);
    if (size !== asset.size) {
      throw new Error(`Unexpected size for ${name}: expected ${asset.size}, got ${size}.`);
    }
    const digest = await checksums(path);
    if (digest.sha256Hex !== approvedSha256[name]) {
      throw new Error(`${name} is not the approved source file (SHA-256 mismatch).`);
    }
    prepared.push({ name, path, size, md5Base64: digest.md5Base64 });
  }

  // Validate every local input before writing any of the five stable IDs.
  for (const { name, path, size, md5Base64: expectedMd5 } of prepared) {
    const asset = motionAssets[name];
    const file = templateFile(asset.id);
    const [exists] = await file.exists();
    if (exists) {
      if (await storedMatches(name, expectedMd5)) {
        process.stdout.write(`Already seeded ${name} (${size} bytes)\n`);
        continue;
      }
      const [metadata] = await file.getMetadata();
      if (!metadata.generation) throw new Error(`Cannot safely refresh ${name}: App Storage did not return its generation.`);
      try {
        await writeAsset(name, path, Number(metadata.generation));
      } catch (error) {
        if (Number((error as { code?: number }).code) !== 409 && Number((error as { code?: number }).code) !== 412) throw error;
        if (!(await storedMatches(name, expectedMd5))) throw error;
      }
      process.stdout.write(`Refreshed ${name} (${size} bytes)\n`);
    } else {
      try {
        await writeAsset(name, path, 0);
      } catch (error) {
        if (Number((error as { code?: number }).code) !== 409 && Number((error as { code?: number }).code) !== 412) throw error;
        if (!(await storedMatches(name, expectedMd5))) throw error;
      }
      process.stdout.write(`Seeded ${name} (${size} bytes)\n`);
    }

    if (!(await storedMatches(name, expectedMd5))) {
      throw new Error(`App Storage verification failed for ${name}.`);
    }
  }
}

seed().catch(error => {
  process.stderr.write(`Could not seed the Genjutsu community example: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
