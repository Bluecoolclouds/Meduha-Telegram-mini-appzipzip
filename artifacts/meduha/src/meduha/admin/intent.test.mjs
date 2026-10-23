// Run: node --experimental-strip-types artifacts/meduha/src/meduha/admin/intent.test.mjs  (Node >= 22.6)
import test from 'node:test';
import assert from 'node:assert/strict';
const { createIntentStore, intentHash, INTENT_STORAGE_KEY, INTENT_TTL_MS } = await import('./intent.ts');

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
let n = 0; const gen = () => `key-${++n}`;

test('same signature keeps key across store instances (refresh)', () => {
  const s = mem(); const a = createIntentStore(gen, s);
  const k = a.keyFor('admin1|adjust|user9|120|reason');
  const b = createIntentStore(gen, s);
  assert.equal(b.keyFor('admin1|adjust|user9|120|reason'), k);
});
test('different actor gets a different key', () => {
  const s = mem(); const a = createIntentStore(gen, s);
  assert.notEqual(a.keyFor('admin1|x'), a.keyFor('admin2|x'));
});
test('settle removes entry; next intent gets new key', () => {
  const s = mem(); const a = createIntentStore(gen, s);
  const k = a.keyFor('sig'); a.settle('sig');
  assert.notEqual(createIntentStore(gen, s).keyFor('sig'), k);
});
test('storage holds no plaintext signature', () => {
  const s = mem(); createIntentStore(gen, s).keyFor('admin1|adjust|user-secret-id|reason text');
  const raw = s.m.get(INTENT_STORAGE_KEY);
  assert.ok(!raw.includes('user-secret-id') && !raw.includes('reason text'));
  assert.ok(raw.includes(intentHash('admin1|adjust|user-secret-id|reason text')));
});
test('expires after TTL', () => {
  let t = 0; const s = mem(); const a = createIntentStore(gen, s, () => t);
  const k = a.keyFor('sig'); t = INTENT_TTL_MS + 1;
  assert.notEqual(a.keyFor('sig'), k);
});
test('falls back to memory when storage throws', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  const a = createIntentStore(gen, bad);
  const k = a.keyFor('sig'); assert.equal(a.keyFor('sig'), k); assert.equal(a.durable, false);
});
