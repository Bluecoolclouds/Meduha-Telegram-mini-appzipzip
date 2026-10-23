import type { GenjutsuInput } from '@workspace/api-client-react';

export type GenjutsuScenarioId = 'genjutsu' | 'object-swap' | 'restyle';
export const GENJUTSU_IDS: GenjutsuScenarioId[] = ['genjutsu', 'object-swap', 'restyle'];
export const isGenjutsuScenario = (id: string | null | undefined): id is GenjutsuScenarioId => !!id && (GENJUTSU_IDS as string[]).includes(id);

export const UPSTREAM: Record<GenjutsuScenarioId, string> = {
  genjutsu: 'higgsfield/genjutsu/motion-transfer/v1.0',
  'object-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  restyle: 'higgsfield/genjutsu/restyle/v1.0',
};

export type StoredIntent = { key: string; signature: string; payload: GenjutsuInput; savedAt: number };

const storageKey = (account: string, scenario: GenjutsuScenarioId) => `meduha-genjutsu-intent:${account}:${scenario}`;

export function payloadSignature(payload: Omit<GenjutsuInput, 'idempotencyKey' | 'quoteToken'> | GenjutsuInput): string {
  const { modelId, scenario, videoId, imageIds, prompt, resolution, presetId } = payload;
  return JSON.stringify([modelId, scenario, videoId, imageIds, prompt, resolution, presetId ?? null]);
}

export function readIntent(account: string, scenario: GenjutsuScenarioId): StoredIntent | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(account, scenario));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIntent;
    if (!parsed?.key || !parsed.payload || parsed.payload.idempotencyKey !== parsed.key) return null;
    if (payloadSignature(parsed.payload) !== parsed.signature) return null;
    return parsed;
  } catch { return null; }
}

export function writeIntent(account: string, scenario: GenjutsuScenarioId, intent: StoredIntent): boolean {
  try { window.sessionStorage.setItem(storageKey(account, scenario), JSON.stringify(intent)); return true; } catch { return false; }
}

export function clearIntent(account: string, scenario: GenjutsuScenarioId) {
  try { window.sessionStorage.removeItem(storageKey(account, scenario)); } catch { /* storage unavailable */ }
}

export function mediaUuid(objectPath: string): string | null {
  const match = objectPath.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i);
  return match ? match[1].toLowerCase() : null;
}

export type VideoMeta = { duration: number; width: number; height: number };
export function readVideoMeta(url: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata'; el.muted = true;
    const done = () => { el.removeAttribute('src'); el.load(); };
    el.onloadedmetadata = () => { const meta = { duration: el.duration, width: el.videoWidth, height: el.videoHeight }; done(); resolve(meta); };
    el.onerror = () => { done(); reject(new Error('Браузер не смог прочитать это видео. Попробуй другой файл MP4 или WebM.')); };
    el.src = url;
  });
}
