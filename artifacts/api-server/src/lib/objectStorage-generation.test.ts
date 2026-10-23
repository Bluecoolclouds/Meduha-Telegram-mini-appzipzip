import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { objectStorageClient, storeGenerationVideo, MAX_GENERATION_VIDEO_BYTES } from './objectStorage';

type StoredObject = { bytes: Buffer; contentType: string };

function mockBucket(t: TestContext, objects: Map<string, StoredObject>) {
  t.mock.method(objectStorageClient, 'bucket', (bucketName: string) => ({
    file(objectName: string) {
      const key = `${bucketName}/${objectName}`;
      return {
        name: objectName,
        exists: async () => [objects.has(key)],
        getMetadata: async () => {
          const stored = objects.get(key);
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 });
          return [{ size: String(stored.bytes.length), contentType: stored.contentType }];
        },
        createWriteStream: (options: { metadata: { contentType: string } }) => {
          const chunks: Buffer[] = [];
          return new Writable({
            write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
            final(callback) {
              objects.set(key, { bytes: Buffer.concat(chunks), contentType: options.metadata.contentType });
              callback();
            },
          });
        },
        copy: async (destination: { name: string }, options: { preconditionOpts: { ifGenerationMatch: number } }) => {
          const destinationKey = `${bucketName}/${destination.name}`;
          if (options.preconditionOpts.ifGenerationMatch === 0 && objects.has(destinationKey)) {
            throw Object.assign(new Error('already exists'), { code: 412 });
          }
          const stored = objects.get(key);
          if (!stored) throw new Error('source object missing');
          objects.set(destinationKey, stored);
        },
        delete: async () => { objects.delete(key); },
      };
    },
  }) as unknown as ReturnType<typeof objectStorageClient.bucket>);
}

function mp4Fixture() {
  const bytes = Buffer.alloc(24);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('isom', 8, 'ascii');
  return bytes;
}

test('generation videos are validated, stored privately once, and reused on retry', async t => {
  const previousDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = 'test-bucket/private-generation';
  t.after(() => {
    if (previousDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previousDir;
  });
  const objects = new Map<string, StoredObject>();
  mockBucket(t, objects);
  const id = randomUUID();
  let downloadCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    downloadCalls++;
    assert.equal(String(input), 'https://cdn.provider.test/result.mp4');
    assert.equal(init?.redirect, 'manual');
    return new Response(mp4Fixture(), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '24' } });
  };
  const resolveHost = async () => [{ address: '93.184.216.34', family: 4 as const }];

  const stored = await storeGenerationVideo(id, 'https://cdn.provider.test/result.mp4', fetcher, resolveHost);
  assert.deepEqual(stored, { size: 24, contentType: 'video/mp4' });
  assert.equal(objects.size, 1, 'temporary storage is removed after the private copy');
  assert.equal([...objects.keys()][0], `test-bucket/private-generation/generation-results/${id}.video`);
  assert.deepEqual([...objects.values()][0].bytes, mp4Fixture());

  const repeated = await storeGenerationVideo(id, 'https://cdn.provider.test/result.mp4', fetcher, resolveHost);
  assert.deepEqual(repeated, stored);
  assert.equal(downloadCalls, 1, 'retry reuses the deterministic private object without downloading twice');
});

test('generation video copy rejects local destinations, invalid MIME/content, and oversized responses', async t => {
  const previousDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = 'test-bucket/private-generation-invalid';
  t.after(() => {
    if (previousDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previousDir;
  });
  const objects = new Map<string, StoredObject>();
  mockBucket(t, objects);
  const resolveHost = async () => [{ address: '93.184.216.34', family: 4 as const }];
  let unexpectedFetch = false;
  const fetcher: typeof fetch = async () => {
    unexpectedFetch = true;
    return new Response(mp4Fixture(), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '24' } });
  };
  await assert.rejects(storeGenerationVideo(
    randomUUID(), 'https://127.0.0.1/private.mp4', fetcher, resolveHost,
  ), /publicly reachable/);
  assert.equal(unexpectedFetch, false, 'private IP URLs are rejected before a network request');

  await assert.rejects(storeGenerationVideo(
    randomUUID(), 'https://cdn.provider.test/not-video', async () =>
      new Response(mp4Fixture(), { headers: { 'Content-Type': 'text/plain', 'Content-Length': '24' } }), resolveHost,
  ), /unsupported MIME/);

  await assert.rejects(storeGenerationVideo(
    randomUUID(), 'https://cdn.provider.test/fake.mp4', async () =>
      new Response(Buffer.alloc(24, 65), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '24' } }), resolveHost,
  ), /does not match/);

  await assert.rejects(storeGenerationVideo(
    randomUUID(), 'https://cdn.provider.test/too-large.mp4', async () =>
      new Response(mp4Fixture(), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(MAX_GENERATION_VIDEO_BYTES + 1) } }), resolveHost,
  ), /exceeds the limit/);
  assert.equal([...objects.keys()].some(key => key.endsWith('.video')), false, 'invalid content never becomes a final result');
});
