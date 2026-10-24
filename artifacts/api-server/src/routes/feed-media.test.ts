import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFeedMediaRouter, byteRange } from './feed-media';
import type { variantFile } from '../lib/feed-media';

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
