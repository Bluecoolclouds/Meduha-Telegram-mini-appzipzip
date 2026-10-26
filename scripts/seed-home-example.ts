import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { motionAssets } from '../artifacts/api-server/src/lib/motion-example';
import { templateFile } from '../artifacts/api-server/src/lib/objectStorage';
import { seedAssets } from './seed-motion-example';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const names = [
  'home-video.mp4',
  'home-video-poster.webp',
  'home-photo-1.webp',
  'home-photo-2.webp',
  'home-photo-3.webp',
  'home-photo-4.webp',
] as const;

const assets = Object.fromEntries(names.map(name => [name, motionAssets[name]]));
const approvedSha256: Record<(typeof names)[number], string> = {
  'home-video.mp4': '8b5710284219777430073c696ef34aceffdae95bc0eb3a31ba6a28afe2a6a431',
  'home-video-poster.webp': '84c1246b635f779ee0b98eec8427431e10e641362f1b507ad900a7a163d02950',
  'home-photo-1.webp': 'd33165170aabe63f434e27fb2a8d6b409f131dea3fff1e9a2fcb39c536d58ced',
  'home-photo-2.webp': '053c7247d90709f575cd7c670dfe78a6618858501457b3d2badadca31143f62a',
  'home-photo-3.webp': '81ea169464cb782a791b28c7399007a7c22b456b21c3e7d30229fc146de57b16',
  'home-photo-4.webp': 'fe073d7c4f69b814d27c55b1340f0195092069a24dd4f5ebd64abd32ecbbb2b7',
};

async function seedHomeExample() {
  await seedAssets({
    assets,
    approvedSha256,
    sourcePath: name => Promise.resolve(resolve(scriptDir, 'assets', name)),
    templateFile: id => templateFile(id),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedHomeExample().catch(error => {
    process.stderr.write(`Could not seed the home example media: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
