import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Storage } from '@google-cloud/storage';
import { pipeStorageReadStream } from './storage-stream';

test('storage transport preserves reads, ranges, failures and cancellation without duplicate listeners', { timeout: 20_000 }, async t => {
  const childCase = process.env.STORAGE_TRANSPORT_CHILD_CASE;
  if (childCase) {
    const storage = new Storage({
      projectId: 'fixture',
      apiEndpoint: process.env.STORAGE_TRANSPORT_FIXTURE_URL,
      useAuthWithCustomEndpoint: false,
      retryOptions: { autoRetry: false },
    });
    const proxy = createServer((_req, res) => {
      const file = storage.bucket('fixture-bucket').file(childCase === 'before-response' ? 'delayed' : 'slow');
      const stream = file.createReadStream({ validation: false });
      pipeStorageReadStream(stream, res, () => res.destroy());
      res.flushHeaders();
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const address = proxy.address();
    assert(address && typeof address !== 'string');

    await new Promise<void>((resolve, reject) => {
      const request = httpGet(`http://127.0.0.1:${address.port}/media`);
      request.on('response', response => {
        const disconnect = () => {
          response.once('close', resolve);
          response.destroy();
        };
        if (childCase === 'before-response') disconnect();
        else response.once('data', disconnect);
      });
      request.on('error', error => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(error);
      });
    });
    await new Promise(resolve => setTimeout(resolve, childCase === 'before-response' ? 350 : 50));
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    return;
  }

  const bytes = Buffer.alloc(32_768, 'a');
  const warnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning.message);
  };
  process.on('warning', onWarning);
  t.after(() => process.removeListener('warning', onWarning));
  let slowClosed = false;
  let delayedClosed = false;
  let delayedResponseSent = false;
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
    if (path.endsWith('/delayed')) {
      res.on('close', () => { delayedClosed = true; });
      setTimeout(() => {
        delayedResponseSent = true;
        res.setHeader('content-length', bytes.length);
        res.end(bytes);
      }, 200);
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
  await t.test('isolated server survives a client disconnect before the upstream response', async () => {
    const result = await runIsolatedDisconnect('before-response', address.port);
    assert.equal(result.code, 0, result.output);
    assert.equal(delayedResponseSent, true, `the delayed upstream response should arrive after the client disconnects; child output: ${result.output}`);
    assert.equal(delayedClosed, true, 'the upstream connection should be closed after its response is initialized');
  });
  await t.test('isolated server survives a client disconnect during transfer', async () => {
    const result = await runIsolatedDisconnect('during-transfer', address.port);
    assert.equal(result.code, 0, result.output);
    for (let attempt = 0; attempt < 100 && !slowClosed; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(slowClosed, true, 'the active upstream connection should close after the client disconnects');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(warnings, []);
});

function runIsolatedDisconnect(testCase: string, port: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      process.argv[1],
    ], {
      env: {
        ...process.env,
        STORAGE_TRANSPORT_CHILD_CASE: testCase,
        STORAGE_TRANSPORT_FIXTURE_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}
