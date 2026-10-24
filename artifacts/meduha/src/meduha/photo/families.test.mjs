import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { familyOf, filterFamilies, groupFamilies, photoModelHref, familyPrice } from './families.ts';

const cat = JSON.parse(readFileSync(new URL('../../../../api-server/src/lib/photo-catalog.json', import.meta.url), 'utf8'));
const models = cat.models;
const f = (o = {}) => filterFamilies(models, { q: '', mode: 'all', provider: 'all', providerOf: m => m.endpoint.split('/')[0], text: m => `${m.name} ${m.id}`, ...o });

test('catalogue has 20 modes, unique families, all reachable once', () => {
  assert.equal(models.length, 20);
  const groups = groupFamilies(models);
  assert.equal(new Set(groups.map(g => g.family.id)).size, groups.length);
  const ids = groups.flatMap(g => g.members.map(m => m.id)).sort();
  assert.deepEqual(ids, models.map(m => m.id).sort());
  assert.equal(groups.length, 12);
});
test('explicit SOUL / Recraft / Marketing / Qwen grouping', () => {
  const g = groupFamilies(models);
  const soul = g.filter(x => x.members.some(m => m.id.includes('soul')));
  assert.equal(soul.length, 1); assert.equal(soul[0].members.length, 3);
  assert.equal(g.find(x => x.family.id === 'recraft-4.1').members.length, 4);
  assert.equal(g.find(x => x.family.id === 'marketing-studio').members.length, 3);
  assert.equal(g.find(x => x.family.id === 'qwen-image-3').members.length, 2);
});
test('workflows stay distinct scenarios', () => {
  for (const id of ['workflows/product-shots', 'workflows/graphic-ads', 'workflows/marketplace-design', 'workflows/ads-studio']) {
    assert.equal(familyOf(id).id, id); assert.equal(familyOf(id).modes.length, 1);
  }
  assert.equal(f({ mode: 'workflow' }).length, 4);
});
test('legacy exact deep links resolve to family and mode', () => {
  for (const m of models) { assert.ok(familyOf(m.id).modes.some(x => x.id === m.id)); assert.match(photoModelHref(m.id), /photoModel=/); }
});
test('filters return family once and open matching mode', () => {
  const img = f({ mode: 'image' });
  assert.equal(img.find(g => g.family.id === 'soul').initial.id, 'higgsfield-ai/soul/v2/image-to-image');
  assert.equal(f({ q: 'soul' }).filter(g => g.family.id === 'soul').length, 1);
  assert.equal(f({ q: 'utility/pro' })[0].initial.id, 'recraft/v4.1/utility/pro/text-to-image');
  assert.equal(f({ q: 'sunburst' })[0].initial.id, 'marketing-studio/image/sunburst');
});
test('price minimum labelled from only when differs', () => {
  assert.deepEqual(familyPrice([{ p: 5 }, { p: 3 }, { p: null }], x => x.p), { value: 3, from: true });
  assert.deepEqual(familyPrice([{ p: 4 }], x => x.p), { value: 4, from: false });
  assert.equal(familyPrice([{ p: null }], x => x.p), null);
});
