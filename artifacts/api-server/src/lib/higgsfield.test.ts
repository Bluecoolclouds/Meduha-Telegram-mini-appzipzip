import { test } from 'node:test';
import assert from 'node:assert/strict';
import { higgsfieldCredentials, submitHiggsfieldGeneration } from './higgsfield';

async function withCredential(value: string, check: () => void | Promise<void>) {
  const keys = ['HF_API_KEY', 'HF_CREDENTIALS', 'higgs', 'higgs_api'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.HF_API_KEY = '';
    process.env.HF_CREDENTIALS = '';
    process.env.higgs = '';
    process.env.higgs_api = value;
    await check();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('accepts the complete copied higgs_api credential without requiring a colon', async () => {
  await withCredential('synthetic-opaque-api-key', () => {
    assert.equal(higgsfieldCredentials(), 'synthetic-opaque-api-key');
  });
  await withCredential('test-key-id:test-key-secret', () => {
    assert.equal(higgsfieldCredentials(), 'test-key-id:test-key-secret');
  });
});

test('REST submission preserves the key header, endpoint and JSON input', async () => {
  await withCredential('synthetic-opaque-api-key', async () => {
    let calls = 0;
    const input = { prompt: 'Synthetic test only', duration: 5, resolution: '720p' };
    const fetcher: typeof fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Key synthetic-opaque-api-key');
      assert.deepEqual(JSON.parse(String(init?.body)), input);
      return Response.json({ status: 'queued', request_id: 'synthetic-request' });
    };
    const result = await submitHiggsfieldGeneration('bytedance/seedance-2.5/text-to-video', input, fetcher);
    assert.equal(result.request_id, 'synthetic-request');
    assert.equal(calls, 1);
  });
});

test('submission never retries errors or follows redirects and rejects unsafe endpoints', async () => {
  await withCredential('synthetic-opaque-api-key', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response('', { status: 503 });
    };
    await assert.rejects(submitHiggsfieldGeneration('higgsfield/genjutsu/restyle/v1.0', {}, fetcher), /HTTP 503/);
    assert.equal(calls, 1);
    for (const endpoint of ['https://example.test/generate', '../requests', 'model/../generate', 'model?token=x']) {
      await assert.rejects(submitHiggsfieldGeneration(endpoint, {}, fetcher), /Invalid Higgsfield model endpoint/);
    }
    assert.equal(calls, 1, 'unsafe endpoints must never issue a provider request');
  });
});

test('REST submission preserves incoming photo generation image results', async () => {
  await withCredential('synthetic-opaque-api-key', async () => {
    const images = [{ url: 'https://example.test/synthetic-image.png' }];
    const fetcher: typeof fetch = async () => Response.json({
      status: 'completed', request_id: 'synthetic-photo', images,
    });
    const result = await submitHiggsfieldGeneration('higgsfield-ai/soul/v2/standard', { prompt: 'Synthetic only' }, fetcher);
    assert.deepEqual(result.images, images);
  });
});
