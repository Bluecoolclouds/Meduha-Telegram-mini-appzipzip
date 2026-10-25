import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Storage } from '@google-cloud/storage';

test('storage transport preserves reads, ranges, failures and cancellation without duplicate listeners', { timeout: 20_000 }, async t => {
  const bytes = Buffer.alloc(32_768, 'a');
  const warnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning.message);
  };
  process.on('warning', onWarning);
  t.after(() => process.removeListener('warning', onWarning));
  let slowClosed = false;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture').pathname;
    res.setHeader('x-goog-stored-content-encoding', 'identity');
    res.setHeader('content-type', 'application/octet-stream');
    if (path.endsWith('/broken')) {
      res.setHeader('content-length', bytes.length);
      res.write(bytes.subarray(0, 16));
      setTimeout(() => res.destroy(), 10);
      return;
    }
    if (path.endsWith('/slow')) {
      const timer = setInterval(() => res.write(bytes), 5);
      res.on('close', () => { clearInterval(timer); slowClosed = true; });
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (match) {
      const start = Number(match[1]), end = Number(match[2]);
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': end - start + 1,
      });
      res.end(bytes.subarray(start, end + 1));
    } else {
      res.setHeader('content-length', bytes.length);
      res.end(bytes);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const storage = new Storage({
    projectId: 'fixture',
    apiEndpoint: `http://127.0.0.1:${address.port}`,
    useAuthWithCustomEndpoint: false,
    retryOptions: { autoRetry: false },
  });
  const file = (name: string) => storage.bucket('fixture-bucket').file(name);
  const consume = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  await t.test('concurrent complete reads preserve every byte', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      consume(file('ok').createReadStream({ validation: false })),
    ));
    results.forEach(result => assert.deepEqual(result, bytes));
  });
  await t.test('range reads preserve the selected bytes', async () => {
    assert.deepEqual(
      await consume(file('ok').createReadStream({ start: 5, end: 13 })),
      bytes.subarray(5, 14),
    );
  });
  await t.test('a truncated upstream response rejects instead of hanging', async () => {
    await assert.rejects(consume(file('broken').createReadStream({ validation: false })));
  });
  await t.test('cancelling an active read closes its upstream connection', async () => {
    const stream = file('slow').createReadStream({ validation: false });
    await once(stream, 'data');
    const closed = once(stream, 'close');
    stream.destroy();
    await closed;
    for (let attempt = 0; attempt < 100 && !slowClosed; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(slowClosed, true);
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(warnings, []);
});
