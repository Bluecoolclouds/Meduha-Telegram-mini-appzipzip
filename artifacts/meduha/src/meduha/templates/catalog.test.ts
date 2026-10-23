import assert from 'node:assert/strict';
import test from 'node:test';
import { getTemplatePage, templateMediaUrl } from './catalog';

test('template media routes preserve API paths and the artifact base path', () => {
  assert.equal(templateMediaUrl('images/meduha/portrait.png'), '/images/meduha/portrait.png');
  assert.equal(templateMediaUrl('/api/meduha/media/123'), '/api/meduha/media/123');
  assert.equal(templateMediaUrl('https://example.com/video.mp4'), 'https://example.com/video.mp4');
});

test('search and stable cursor pagination are requested from the API without duplicate items', async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `template-${5 - i}`, title: `Template ${5 - i}` }));
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'https://meduha.test');
    requests.push(url);
    const cursor = Number(url.searchParams.get('cursor') ?? '6');
    const page = rows.filter(row => Number(row.id.slice(9)) < cursor && Number(row.id.slice(9)) >= cursor - 2);
    const next = page.length === 2 ? Number(page[page.length - 1].id.slice(9)) : null;
    return Response.json({ items: page, nextCursor: next, total: rows.length });
  };
  try {
    const first = await getTemplatePage({ query: '  Портрет  ', limit: 2 });
    const second = await getTemplatePage({ query: 'Портрет', cursor: first.nextCursor!, limit: 2 });
    const third = await getTemplatePage({ query: 'Портрет', cursor: second.nextCursor!, limit: 2 });
    const seen = [...first.items, ...second.items, ...third.items].map(item => item.id);
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(seen, rows.map(item => item.id));
    assert.equal(first.nextCursor, 4);
    assert.equal(third.nextCursor, null);
    assert.deepEqual(requests.map(url => url.searchParams.get('cursor')), [null, '4', '2']);
    assert.ok(requests.every(url => url.searchParams.get('query') === 'Портрет'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
