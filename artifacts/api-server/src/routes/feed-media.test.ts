import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFeedMediaRouter, byteRange } from './feed-media';
import type { variantFile } from '../lib/feed-media';
import { curatedManifest, createCuratedReader } from '../lib/curated-feed';
import { createHash } from 'node:crypto';

test('range handling supports suffix/seeking and rejects malformed and unsafe ranges', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(byteRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.deepEqual(byteRange('bytes=4-', 10), { start: 4, end: 9 });
  for (const range of ['bytes=-0', 'bytes=10-', 'bytes=5-2', 'bytes=0-1,3-4', 'bytes=99999999999999999-', 'bytes=0-99999999999999999'])
    assert.equal(byteRange(range, 10), null);
});

test('published previews recheck access even for cached media and conditional requests', async () => {
  let published = true;
  let prepared = 0;
  let lookupCount = 0;
  let revokeDuringPrepare = false;
  const id = '11111111-1111-4111-8111-111111111111';
  const bytes = Buffer.from('small-preview-bytes');
  const app = express();
  app.use(createFeedMediaRouter({
    findPublished: async () => { lookupCount++; return published ? { poster: `/api/meduha/media/${id}`, video: `/api/meduha/media/${id}`, kind: 'video' } : undefined; },
    prepare: async () => { prepared++; if (revokeDuringPrepare) published = false; },
    file: () => ({
      getMetadata: async () => [{ size: bytes.length, generation: 'fixture' }],
      download: async ({ start, end }: { start: number; end: number }) => [bytes.subarray(start, end + 1)],
    }) as unknown as ReturnType<typeof variantFile>,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/feed-media/${id}`;
  try {
    const whole = await fetch(`${base}/preview`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.equal(whole.headers.get('cache-control'), 'private, no-cache');
    assert.equal(await whole.text(), bytes.toString());
    const cached = await fetch(`${base}/preview`, { headers: { 'If-None-Match': '"feed-fixture"' } });
    assert.equal(cached.status, 304);
    const part = await fetch(`${base}/preview`, { headers: { Range: 'bytes=1-4' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), bytes.subarray(1, 5).toString());
    const invalid = await fetch(`${base}/preview`, { headers: { Range: 'bytes=-0' } });
    assert.equal(invalid.status, 416);
    await invalid.arrayBuffer();
    const callsBeforeRevocation = prepared;
    published = false;
    const hidden = await fetch(`${base}/preview`, { headers: { 'If-None-Match': '"feed-fixture"' } });
    assert.equal(hidden.status, 404);
    await hidden.arrayBuffer();
    assert.equal(prepared, callsBeforeRevocation);
    assert.equal(lookupCount, 9);
    for (const options of [
      { method: 'HEAD', headers: { 'If-None-Match': '"feed-fixture"' } },
      { headers: { Range: 'bytes=0-3' } },
      { headers: { Range: 'bytes=0-3', 'If-None-Match': '"feed-fixture"' } },
    ]) {
      const revoked = await fetch(`${base}/preview?v=public`, options);
      assert.equal(revoked.status, 404);
      assert.equal(revoked.headers.get('cache-control'), 'no-store');
      await revoked.arrayBuffer();
    }
    published = true;
    revokeDuringPrepare = true;
    const revokedWhilePreparing = await fetch(`${base}/preview`);
    assert.equal(revokedWhilePreparing.status, 404);
    await revokedWhilePreparing.arrayBuffer();
    const unknown = await fetch(`${base}/original`);
    assert.equal(unknown.status, 404);
    await unknown.arrayBuffer();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('all approved curated assets serve HEAD/304 without storage, encoding or publication queries', async () => {
  let reads = 0;
  const app = express();
  app.use(createFeedMediaRouter({
    findPublished: async () => { throw new Error('Unexpected publication query'); },
    prepare: async () => { throw new Error('Unexpected encoder/storage existence check'); },
    file: () => { throw new Error('Unexpected metadata lookup'); },
    readCurated: async asset => { reads++; return Buffer.alloc(asset.size, 42); },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/feed-media`;
  try {
    assert.equal(Object.keys(curatedManifest).length, 9);
    let count = 0;
    for (const [id, variants] of Object.entries(curatedManifest)) {
      for (const [variant, asset] of Object.entries(variants)) {
        if (!asset) continue;
        count++;
        assert.match(asset.object, new RegExp(`^curated-feed/v1/${asset.sha256}\\.(webp|mp4)$`));
        const url = `${base}/${id}/${variant}?v=${asset.sha256}`;
        const head = await fetch(url, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(asset.size));
        assert.equal(head.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        const etag = head.headers.get('etag')!;
        const cached = await fetch(url, { headers: { 'If-None-Match': `W/${etag}, "other"` } });
        assert.equal(cached.status, 304);
        assert.equal((await cached.arrayBuffer()).byteLength, 0);
        assert.equal(reads, count - 1);
        const part = await fetch(url, { headers: { Range: 'bytes=1-4', 'If-Range': etag } });
        assert.equal(part.status, 206);
        assert.equal(part.headers.get('content-range'), `bytes 1-4/${asset.size}`);
        assert.deepEqual(Buffer.from(await part.arrayBuffer()), Buffer.alloc(4, 42));
      }
    }
    assert.equal(count, 12);
    const asset = curatedManifest['example-space'].thumb!;
    const url = `${base}/example-space/thumb`;
    const legacy = await fetch(url, { method: 'HEAD' });
    assert.equal(legacy.headers.get('cache-control'), 'public, no-cache');
    const mismatch = await fetch(`${url}?v=old`, { headers: { 'If-None-Match': `"curated-${asset.sha256}"` } });
    assert.equal(mismatch.status, 404);
    assert.equal(mismatch.headers.get('cache-control'), 'no-store');
    await mismatch.arrayBuffer();
    for (const range of ['bytes=-0', 'bytes=9999999-', 'bytes=0-1,3-4']) {
      const bad = await fetch(url, { headers: { Range: range } });
      assert.equal(bad.status, 416);
      assert.equal(bad.headers.get('content-range'), `bytes */${asset.size}`);
      await bad.arrayBuffer();
    }
    const suffix = await fetch(url, { headers: { Range: 'bytes=-10' } });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 10);
    const changed = await fetch(url, { headers: { Range: 'bytes=0-3', 'If-Range': '"stale"' } });
    assert.equal(changed.status, 200);
    assert.equal((await changed.arrayBuffer()).byteLength, asset.size);
    for (const path of ['example-space/preview', 'https%3A%2F%2Fexample.com/thumb', '__proto__/thumb', 'constructor/thumb', 'example-unknown/thumb']) {
      const unknown = await fetch(`${base}/${path}`);
      assert.equal(unknown.status, 404);
      await unknown.arrayBuffer();
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('curated byte cache is single-flight, verifies content and retries failures without caching errors', async () => {
  const bytes = Buffer.from('approved derivative');
  const asset = { object: 'curated-feed/v1/fixture.webp', generation: '123', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  let calls = 0;
  const read = createCuratedReader(async input => {
    calls++;
    assert.equal(input.generation, '123');
    return bytes;
  });
  assert.deepEqual(await Promise.all([read(asset), read(asset), read(asset)]), [bytes, bytes, bytes]);
  assert.equal(await read(asset), bytes);
  assert.equal(calls, 1);
  let failures = 0;
  const retry = createCuratedReader(async () => { failures++; return failures === 1 ? Buffer.alloc(bytes.length) : bytes; });
  await assert.rejects(retry(asset), /integrity mismatch/);
  assert.equal(await retry(asset), bytes);
  assert.equal(failures, 2);
  await assert.rejects(read({ ...asset, size: 2 ** 30 }), /Invalid curated asset size/);
});

test('storage errors on curated GET return uncached 503 without stale media headers', async () => {
  const app = express();
  app.use((req, _res, next) => { req.log = { warn() {} } as unknown as typeof req.log; next(); });
  app.use(createFeedMediaRouter({ readCurated: async () => { throw new Error('Storage unavailable'); } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/feed-media/example-space/thumb`,
      { headers: { Range: 'bytes=0-9' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!response.headers.get('etag')?.startsWith('"curated-'));
    assert.equal(response.headers.get('content-range'), null);
    assert.ok((await response.json() as { error?: string }).error);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
