import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { objectStorageClient } from '../lib/objectStorage';
import { motionAssets } from '../lib/motion-example';
import exampleMediaRouter from './example-media';

const approvedVideos = ['motion-result.mp4', 'motion-reference.mp4'] as const;

test('approved example videos support byte ranges, reject invalid ranges, and answer HEAD without a body', async t => {
  const previousObjectDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = 'test-bucket/example-media';
  t.after(() => {
    if (previousObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previousObjectDir;
  });

  const stored = new Map<string, Buffer>();
  for (const name of approvedVideos) {
    const asset = motionAssets[name];
    stored.set(asset.id, Buffer.from(`fixture:${name}:video-bytes`));
  }
  t.mock.method(objectStorageClient, 'bucket', (bucketName: string) => ({
    file(objectName: string) {
      const id = objectName.split('/').at(-1)!;
      const bytes = stored.get(id);
      assert(bytes, `unexpected storage object ${bucketName}/${objectName}`);
      return {
        getMetadata: async () => [{ size: String(bytes.length) }],
        createReadStream: ({ start, end }: { start: number; end: number }) =>
          Readable.from([bytes.subarray(start, end + 1)]),
      };
    },
  }) as unknown as ReturnType<typeof objectStorageClient.bucket>);

  const app = express();
  app.use((req, _res, next) => {
    req.log = { warn() {} } as any;
    next();
  });
  app.use('/example-media', exampleMediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/example-media`;
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const outboundRequests: Array<{ url: string; method: string; range: string | null }> = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(baseUrl)) return nativeFetch(input, init);
    const method = init?.method ?? 'GET';
    const range = new Headers(init?.headers).get('range');
    outboundRequests.push({ url, method, range });

    const bytes = Buffer.from('public fixture');
    const headers = new Headers({
      'content-type': url.endsWith('.png') ? 'image/png' : 'video/webm',
      'accept-ranges': 'bytes',
      'content-length': String(bytes.length),
    });
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      assert(match, `unexpected test range: ${range}`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const partial = bytes.subarray(start, end + 1);
      headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`);
      headers.set('content-length', String(partial.length));
      return new Response(method === 'HEAD' ? null : partial, { status: 206, headers });
    }
    return new Response(method === 'HEAD' ? null : bytes, { status: 200, headers });
  });

  for (const name of approvedVideos) {
    const asset = motionAssets[name];
    const bytes = stored.get(asset.id)!;

    const partial = await fetch(`${baseUrl}/${name}`, { headers: { Range: 'bytes=2-7' } });
    assert.equal(partial.status, 206, `${name} should return a partial response`);
    assert.equal(partial.headers.get('content-range'), `bytes 2-7/${bytes.length}`);
    assert.equal(partial.headers.get('content-type'), asset.contentType);
    assert.equal(partial.headers.get('accept-ranges'), 'bytes');
    assert.equal(partial.headers.get('content-length'), '6');
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(2, 8));

    for (const { range, start, end } of [
      { range: 'bytes=8-', start: 8, end: bytes.length - 1 },
      { range: 'bytes=-5', start: bytes.length - 5, end: bytes.length - 1 },
    ]) {
      const ranged = await fetch(`${baseUrl}/${name}`, { headers: { Range: range } });
      assert.equal(ranged.status, 206, `${name} should support ${range}`);
      assert.equal(ranged.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
      assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(start, end + 1));
    }

    for (const range of ['items=2-7', `bytes=${bytes.length}-`]) {
      const rejected = await fetch(`${baseUrl}/${name}`, { headers: { Range: range } });
      assert.equal(rejected.status, 416, `${name} should reject range ${range}`);
      assert.equal(rejected.headers.get('content-range'), `bytes */${bytes.length}`);
      assert.equal((await rejected.arrayBuffer()).byteLength, 0);
    }

    const head = await fetch(`${baseUrl}/${name}`, {
      method: 'HEAD',
      headers: { Range: 'bytes=2-7' },
    });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-range'), `bytes 2-7/${bytes.length}`);
    assert.equal(head.headers.get('content-type'), asset.contentType);
    assert.equal(head.headers.get('content-length'), '6');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }

  const unknown = await fetch(`${baseUrl}/unknown-media.webm`);
  assert.equal(unknown.status, 404);
  assert.equal(outboundRequests.length, 0, 'unknown names must not trigger an outbound fetch');

  const publicSources = {
    'flower.webm': 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
    'sintel.webm': 'https://media.w3.org/2010/05/sintel/trailer.webm',
    'sintel.png': 'https://media.w3.org/2010/05/sintel/poster.png',
  };
  const publicVideoNames = ['flower.webm', 'sintel.webm'] as const;
  for (const [name, source] of Object.entries(publicSources)) {
    const response = await fetch(`${baseUrl}/${name}`);
    assert.equal(response.status, 200, `${name} should be served from its approved source`);
    assert.equal(response.headers.get('content-type'), name.endsWith('.png') ? 'image/png' : 'video/webm');
    assert.equal(await response.text(), 'public fixture');
    assert.deepEqual(outboundRequests.at(-1), { url: source, method: 'GET', range: null });
  }

  for (const name of publicVideoNames) {
    const source = publicSources[name];
    const range = 'bytes=2-7';

    const partial = await fetch(`${baseUrl}/${name}`, { headers: { Range: range } });
    assert.equal(partial.status, 206, `${name} should return a partial public-source response`);
    assert.equal(partial.headers.get('content-range'), `bytes 2-7/14`);
    assert.equal(partial.headers.get('content-length'), '6');
    assert.equal(partial.headers.get('content-type'), 'video/webm');
    assert.equal(partial.headers.get('accept-ranges'), 'bytes');
    assert.equal(await partial.text(), 'blic f');
    assert.deepEqual(outboundRequests.at(-1), { url: source, method: 'GET', range });

    const head = await fetch(`${baseUrl}/${name}`, { method: 'HEAD' });
    assert.equal(head.status, 200, `${name} should answer public-source HEAD`);
    assert.equal(head.headers.get('content-type'), 'video/webm');
    assert.equal(head.headers.get('content-length'), '14');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.deepEqual(outboundRequests.at(-1), { url: source, method: 'HEAD', range: null });
  }
  assert.deepEqual(outboundRequests.map(request => request.url), [
    ...Object.values(publicSources),
    publicSources['flower.webm'],
    publicSources['flower.webm'],
    publicSources['sintel.webm'],
    publicSources['sintel.webm'],
  ]);
});
