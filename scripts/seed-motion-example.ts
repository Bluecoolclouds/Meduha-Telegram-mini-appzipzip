import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { motionAssets } from '../artifacts/api-server/src/lib/motion-example';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const mediaDir = resolve(projectRoot, process.env.MOTION_EXAMPLE_MEDIA_DIR ?? 'attached_assets');
const bundledSources: Partial<Record<keyof typeof motionAssets, string>> = {
  'motion-poster.jpg': 'motion-poster.jpg',
  'home-video.mp4': 'home-video.mp4',
  'home-video-poster.webp': 'home-video-poster.webp',
  'home-photo-1.webp': 'home-photo-1.webp',
  'home-photo-2.webp': 'home-photo-2.webp',
  'home-photo-3.webp': 'home-photo-3.webp',
  'home-photo-4.webp': 'home-photo-4.webp',
};

export interface SeedAsset {
  id: string;
  contentType: string;
  size: number;
}

interface StoredMetadata {
  size?: string | number;
  contentType?: string;
  md5Hash?: string;
  generation?: string | number;
}

export interface SeedStorageFile {
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[StoredMetadata, unknown?]>;
  createReadStream(): Readable;
  createWriteStream(options: {
    resumable: false;
    preconditionOpts: { ifGenerationMatch: number };
    metadata: { contentType: string; cacheControl: string };
  }): Writable;
}

export interface SeedAssetsOptions {
  assets: Record<string, SeedAsset>;
  approvedSha256: Record<string, string>;
  sourcePath(name: string): Promise<string>;
  templateFile(id: string): SeedStorageFile;
  writeOutput?: (message: string) => void;
}

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
  'home-video.mp4': '8b5710284219777430073c696ef34aceffdae95bc0eb3a31ba6a28afe2a6a431',
  'home-video-poster.webp': '84c1246b635f779ee0b98eec8427431e10e641362f1b507ad900a7a163d02950',
  'home-photo-1.webp': 'd33165170aabe63f434e27fb2a8d6b409f131dea3fff1e9a2fcb39c536d58ced',
  'home-photo-2.webp': '053c7247d90709f575cd7c670dfe78a6618858501457b3d2badadca31143f62a',
  'home-photo-3.webp': '81ea169464cb782a791b28c7399007a7c22b456b21c3e7d30229fc146de57b16',
  'home-photo-4.webp': 'fe073d7c4f69b814d27c55b1340f0195092069a24dd4f5ebd64abd32ecbbb2b7',
};

async function sourcePath(name: keyof typeof motionAssets): Promise<string> {
  const bundled = bundledSources[name];
  if (bundled) return resolve(scriptDir, 'assets', bundled);
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
    `Missing ${name}. Restore its approved copy under scripts/assets or put the approved Genjutsu source media in ${mediaDir}.`,
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

async function storedMd5Base64(file: SeedStorageFile): Promise<string> {
  const [metadata] = await file.getMetadata();
  if (metadata.md5Hash) return metadata.md5Hash;
  const hash = createHash('md5');
  for await (const chunk of file.createReadStream()) hash.update(chunk);
  return hash.digest('base64');
}

async function storedMatches(
  name: string,
  assets: Record<string, SeedAsset>,
  getFile: (id: string) => SeedStorageFile,
  expectedMd5: string,
): Promise<boolean> {
  const asset = assets[name];
  const file = getFile(asset.id);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  const storedMd5 = await storedMd5Base64(file);
  return size === asset.size && metadata.contentType === asset.contentType && storedMd5 === expectedMd5;
}

async function writeAsset(
  name: string,
  path: string,
  generationMatch: number,
  assets: Record<string, SeedAsset>,
  getFile: (id: string) => SeedStorageFile,
): Promise<void> {
  const asset = assets[name];
  await pipeline(
    createReadStream(path),
    getFile(asset.id).createWriteStream({
      resumable: false,
      preconditionOpts: { ifGenerationMatch: generationMatch },
      metadata: { contentType: asset.contentType, cacheControl: 'private,no-cache' },
    }),
  );
}

export async function seedAssets(options: SeedAssetsOptions): Promise<void> {
  const { assets, approvedSha256, sourcePath: resolveSource, templateFile: getFile } = options;
  const output = options.writeOutput ?? (message => process.stdout.write(message));
  const prepared: { name: string; path: string; size: number; md5Base64: string }[] = [];
  for (const name of Object.keys(assets)) {
    const asset = assets[name];
    const path = await resolveSource(name);
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

  // Validate every local input before writing any of the stable media IDs.
  for (const { name, path, size, md5Base64: expectedMd5 } of prepared) {
    const asset = assets[name];
    const file = getFile(asset.id);
    const [exists] = await file.exists();
    if (exists) {
      if (await storedMatches(name, assets, getFile, expectedMd5)) {
        output(`Already seeded ${name} (${size} bytes)\n`);
        continue;
      }
      const [metadata] = await file.getMetadata();
      if (!metadata.generation) throw new Error(`Cannot safely refresh ${name}: App Storage did not return its generation.`);
      try {
        await writeAsset(name, path, Number(metadata.generation), assets, getFile);
      } catch (error) {
        if (Number((error as { code?: number }).code) !== 409 && Number((error as { code?: number }).code) !== 412) throw error;
        if (!(await storedMatches(name, assets, getFile, expectedMd5))) throw error;
      }
      output(`Refreshed ${name} (${size} bytes)\n`);
    } else {
      try {
        await writeAsset(name, path, 0, assets, getFile);
      } catch (error) {
        if (Number((error as { code?: number }).code) !== 409 && Number((error as { code?: number }).code) !== 412) throw error;
        if (!(await storedMatches(name, assets, getFile, expectedMd5))) throw error;
      }
      output(`Seeded ${name} (${size} bytes)\n`);
    }

    if (!(await storedMatches(name, assets, getFile, expectedMd5))) {
      throw new Error(`App Storage verification failed for ${name}.`);
    }
  }
}

async function seed(): Promise<void> {
  await seedAssets({
    assets: motionAssets,
    approvedSha256,
    sourcePath: name => sourcePath(name as keyof typeof motionAssets),
    templateFile: id => templateFile(id),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().catch(error => {
    process.stderr.write(`Could not seed the Genjutsu community example: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
