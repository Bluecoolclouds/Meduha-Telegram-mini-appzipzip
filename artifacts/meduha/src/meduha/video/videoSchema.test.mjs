import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPayload, deriveFileFields, dropGroupItem, effective, normalizeFileFields, describeConditions, referencePromptExpansion } from './videoSchema.ts';
const cat = JSON.parse(readFileSync(new URL('../../../../api-server/src/lib/video-catalog.json', import.meta.url)));
test('every family mode resolves to a model; Seedance 2.5 has 5 modes', () => {
  const ids = new Set(cat.models.map(m => m.id));
  for (const f of cat.families) for (const m of f.modes) assert.ok(ids.has(m), m);
  assert.equal(cat.families.find(f => f.name === 'Seedance 2.5').modes.length, 5);
});
test('derived file fields exclude link_url, mark file_url as document', () => {
  for (const m of cat.models) { const ff = deriveFileFields(m.schema); assert.ok(!ff.some(f => f.path === '/link_url'));
    if (m.schema.properties.file_url) assert.equal(ff.find(f => f.path === '/file_url').kind, 'document'); }
});
test('normalize strips /* into array', () => {
  assert.deepEqual(normalizeFileFields([{ path: 'image_urls/*', kind: 'image', array: false }], {}), [{ path: '/image_urls', kind: 'image', array: true }]);
});
test('if/else chain requires last alternative with hints', () => {
  const s = { required: ['prompt'], if: { required: ['image_url'] }, else: { required: ['elements'] }, properties: { prompt: {}, image_url: {}, elements: {} } };
  const e = effective(s, { prompt: 'x' });
  assert.ok(e.required.has('elements')); assert.deepEqual(e.alternatives.elements, ['image_url']);
  assert.ok(!effective(s, { prompt: 'x', image_url: 'u' }).required.has('elements'));
  assert.ok(describeConditions(s)[0].includes('image_url'));
});
test('payload keeps media out of parameters', () => {
  const r = buildPayload({ fileFields: [{ path: '/image_url', kind: 'image', array: false }, { path: '/el/*/image_urls', kind: 'image', array: true }], values: { prompt: 'p', image_url: 'x' }, refs: { '/image_url': [{ id: 'a' }], '/el/0/image_urls': [{ id: 'b' }] }, groups: { el: [{ n: 1 }] } });
  assert.deepEqual(r.parameters, { prompt: 'p', el: [{ n: 1 }] });
  assert.deepEqual(r.references, { '/image_url': ['a'], '/el/0/image_urls': ['b'] });
});
test('dropGroupItem shifts keys', () => {
  assert.deepEqual(Object.keys(dropGroupItem({ '/el/0/x': [], '/el/1/x': [1], '/y': [] }, 'el', 0)).sort(), ['/el/0/x', '/y']);
});
test('Wan document and webpage references force prompt expansion, ordinary image references do not', () => {
  for (const id of ['alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0-prime/reference-to-video']) {
    assert.equal(referencePromptExpansion(id, { link_url: 'https://example.com/reference', prompt_extend: false }), true);
    assert.equal(referencePromptExpansion(id, { file_url: 'private-upload-id' }), true);
    assert.equal(referencePromptExpansion(id, { image_urls: ['private-upload-id'] }), false);
  }
  assert.equal(referencePromptExpansion('bytedance/seedance-2.5/reference-to-video', { link_url: 'https://example.com/reference' }), false);
});
