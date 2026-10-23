/**
 * Durable idempotency-intent store for manual finance operations.
 *
 * A pending intent maps hash(signature) -> random idempotency key. The signature
 * (actor admin ID + operation + payload) is never stored: only a non-security
 * FNV-1a digest is used as the index. Collisions are harmless because the server
 * rejects a reused key with a different payload (IDEMPOTENCY_CONFLICT).
 * Entries are removed only after a confirmed success; otherwise they expire by TTL.
 */
export type KVStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Entry = { k: string; t: number };

export const INTENT_STORAGE_KEY = 'meduha.admin.pendingIntents.v1';
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const INTENT_MAX = 50;

export function intentHash(signature: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < signature.length; i++) {
    const c = signature.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function createIntentStore(newKey: () => string, storage: KVStorage | null, now: () => number = Date.now) {
  const memory = new Map<string, Entry>();
  let durable = storage !== null;
  const read = (): Record<string, Entry> => {
    if (!durable || !storage) return Object.fromEntries(memory);
    try {
      const raw = storage.getItem(INTENT_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      const out: Record<string, Entry> = {};
      for (const [h, v] of Object.entries(parsed as Record<string, unknown>)) {
        const e = v as Partial<Entry>;
        if (typeof e?.k === 'string' && typeof e.t === 'number') out[h] = { k: e.k, t: e.t };
      }
      return out;
    } catch { durable = false; return Object.fromEntries(memory); }
  };
  const write = (all: Record<string, Entry>) => {
    const t = now();
    const kept = Object.entries(all).filter(([, e]) => t - e.t < INTENT_TTL_MS).sort((a, b) => b[1].t - a[1].t).slice(0, INTENT_MAX);
    memory.clear(); kept.forEach(([h, e]) => memory.set(h, e));
    if (!durable || !storage) return;
    try { storage.setItem(INTENT_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { durable = false; }
  };
  return {
    /** Same signature returns the same key until settle() or TTL expiry. */
    keyFor(signature: string): string {
      const h = intentHash(signature); const all = read(); const e = all[h];
      if (e && now() - e.t < INTENT_TTL_MS) return e.k;
      const k = newKey(); all[h] = { k, t: now() }; write(all); return k;
    },
    /** Peek without creating. */
    pending(signature: string): string | null {
      const e = read()[intentHash(signature)]; return e && now() - e.t < INTENT_TTL_MS ? e.k : null;
    },
    /** Call only after the server confirmed the operation. */
    settle(signature: string) { const all = read(); delete all[intentHash(signature)]; write(all); },
    get durable() { return durable; },
  };
}

export function sessionStorageOrNull(): KVStorage | null {
  try {
    const s = window.sessionStorage; const probe = `${INTENT_STORAGE_KEY}.probe`;
    s.setItem(probe, '1'); s.removeItem(probe); return s;
  } catch { return null; }
}
