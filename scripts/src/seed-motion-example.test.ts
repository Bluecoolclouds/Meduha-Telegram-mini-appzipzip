import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { seedAssets, type SeedAsset, type SeedAssetsOptions, type SeedStorageFile } from '../seed-motion-example';

const fixtureAssets: Record<string, SeedAsset> = {
  'motion-a.bin': { id: 'stable-a', contentType: 'application/octet-stream', size: 6 },
  'motion-b.bin': { id: 'stable-b', contentType: 'application/octet-stream', size: 5 },
};

type StoredObject = { bytes: Buffer; contentType: string; generation: number };

class MemoryStorage {
  readonly objects = new Map<string, StoredObject>();
  writes = 0;
  beforeWriteCommit?: (id: string) => void;

  file = (id: string): SeedStorageFile => ({
    exists: async () => [this.objects.has(id)],
    getMetadata: async () => {
      const object = this.objects.get(id);
      if (!object) throw Object.assign(new Error('not found'), { code: 404 });
      return [{
        size: object.bytes.length,
        contentType: object.contentType,
        generation: object.generation,
        md5Hash: createHash('md5').update(object.bytes).digest('base64'),
      }];
    },
    createReadStream: () => Readable.from([Buffer.from(this.objects.get(id)!.bytes)]),
    createWriteStream: options => {
      this.writes++;
      const chunks: Buffer[] = [];
      return new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
        final: callback => {
          this.beforeWriteCommit?.(id);
          const existing = this.objects.get(id);
          const currentGeneration = existing?.generation ?? 0;
          if (currentGeneration !== options.preconditionOpts.ifGenerationMatch) {
            callback(Object.assign(new Error('generation precondition failed'), { code: 412 }));
            return;
          }
          this.objects.set(id, {
            bytes: Buffer.concat(chunks),
            contentType: options.metadata.contentType,
            generation: currentGeneration + 1,
          });
          callback();
        },
      });
    },
  });
}

async function setup(t: TestContext, supplied?: Record<string, Buffer>) {
  const dir = await mkdtemp(join(tmpdir(), 'seed-motion-example-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = new Map<string, string>();
  const hashes: Record<string, string> = {};
  const content = supplied ?? {
    'motion-a.bin': Buffer.from('alpha!'),
    'motion-b.bin': Buffer.from('bravo'),
  };
  for (const [name, bytes] of Object.entries(content)) {
    const path = join(dir, name);
    await writeFile(path, bytes);
    files.set(name, path);
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }

  const storage = new MemoryStorage();
  const options: SeedAssetsOptions = {
    assets: fixtureAssets,
    approvedSha256: hashes,
    sourcePath: async name => {
      const path = files.get(name);
      if (!path) throw new Error(`Missing ${name}`);
      return path;
    },
    templateFile: storage.file,
    writeOutput: () => {},
  };
  return { dir, files, hashes, storage, options };
}

test('missing source files fail during preflight, before any storage writes', async t => {
  const { storage, options } = await setup(t, {
    'motion-a.bin': Buffer.from('alpha!'),
  });

  await assert.rejects(seedAssets(options), /Missing motion-b\.bin/);
  assert.equal(storage.writes, 0);
  assert.equal(storage.objects.size, 0);
});

test('mismatched approved hashes fail during preflight, before any storage writes', async t => {
  const { storage, options } = await setup(t);
  options.approvedSha256['motion-b.bin'] = 'not-the-approved-hash';

  await assert.rejects(seedAssets(options), /motion-b\.bin.*SHA-256 mismatch/);
  assert.equal(storage.writes, 0);
  assert.equal(storage.objects.size, 0);
});

test('a second seed with matching objects does not rewrite or change their generations', async t => {
  const { files, storage, options } = await setup(t);
  await seedAssets(options);
  const firstSnapshot = new Map(
    [...storage.objects].map(([id, object]) => [id, {
      bytes: Buffer.from(object.bytes),
      contentType: object.contentType,
      generation: object.generation,
    }]),
  );
  const writesAfterFirstSeed = storage.writes;

  await seedAssets(options);

  assert.equal(storage.writes, writesAfterFirstSeed);
  assert.deepEqual(storage.objects, firstSnapshot);
  for (const [name, path] of files) {
    assert.deepEqual(storage.objects.get(fixtureAssets[name].id)?.bytes, await readFile(path));
  }
});

test('a concurrent stable-ID replacement is preserved when the seed write loses its generation race', async t => {
  const { storage, options } = await setup(t);
  const id = fixtureAssets['motion-a.bin'].id;
  const concurrentBytes = Buffer.from('newer concurrent object');
  storage.objects.set(id, {
    bytes: Buffer.from('stale!'),
    contentType: fixtureAssets['motion-a.bin'].contentType,
    generation: 7,
  });
  storage.beforeWriteCommit = writtenId => {
    if (writtenId !== id) return;
    storage.beforeWriteCommit = undefined;
    storage.objects.set(id, {
      bytes: concurrentBytes,
      contentType: fixtureAssets['motion-a.bin'].contentType,
      generation: 8,
    });
  };

  await assert.rejects(seedAssets(options), error => (error as { code?: number }).code === 412);
  assert.deepEqual(storage.objects.get(id)?.bytes, concurrentBytes);
  assert.equal(storage.objects.get(id)?.generation, 8);
});
