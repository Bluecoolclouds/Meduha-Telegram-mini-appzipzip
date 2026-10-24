import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestAvailable, generationsFor } from './yield.ts';

test('cheapest ignores unavailable and unpriced models', () => {
  const c = cheapestAvailable([
    { name: 'Off', creditPrice: 1, available: false },
    { name: 'Unpriced', creditPrice: null, available: true },
    { name: 'Pro', creditPrice: 4, available: true },
    { name: 'Lite', creditPrice: 2, available: true },
  ]);
  assert.deepEqual(c, { name: 'Lite', price: 2 });
});

test('no priced model gives no count', () => {
  assert.equal(cheapestAvailable([{ name: 'X', creditPrice: null, available: false }]), null);
  assert.equal(generationsFor(300, null), null);
});

test('count rounds down', () => {
  assert.equal(generationsFor(200, { name: 'Video', price: 18 }), 11);
  assert.equal(generationsFor(10, { name: 'Video', price: 18 }), 0);
});
