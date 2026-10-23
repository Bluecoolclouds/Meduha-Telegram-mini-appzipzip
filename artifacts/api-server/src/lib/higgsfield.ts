import { config as loadEnv } from 'dotenv';
import { createHiggsfieldClient } from '@higgsfield/client/v2';
import { resolve } from 'node:path';

export const SEEDANCE_MODEL = 'bytedance/seedance-2.5/text-to-video';
const HIGGSFIELD_API = 'https://api.higgsfield.ai';

// Existing Replit Secrets take priority; local credentials are never browser env vars.
export function higgsfieldCredentials() {
  loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  const credentials = process.env.HF_CREDENTIALS || process.env.higgs;
  if (!credentials || !/^[^:\s]+:[^:\s]+$/.test(credentials)) {
    throw new Error('HF_CREDENTIALS (or Replit Secret higgs) must contain key-id:key-secret.');
  }
  return credentials;
}

export function higgsfieldClient() {
  // A lost submission response must not silently trigger a second paid POST.
  return createHiggsfieldClient({ credentials: higgsfieldCredentials(), maxRetries: 0 });
}

export async function getHiggsfieldRequestStatus(requestId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid Higgsfield request ID.');
  const response = await fetch(`${HIGGSFIELD_API}/requests/${encodeURIComponent(requestId)}/status`, {
    method: 'GET',
    headers: { Authorization: `Key ${higgsfieldCredentials()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Higgsfield status request failed with HTTP ${response.status}.`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string') {
    throw new Error('Higgsfield returned an invalid request status.');
  }
  return result as { status: string; video?: { url?: string } };
}

export function completedVideo(result: { status: string; video?: { url: string } }): string {
  if (result.status !== 'completed') {
    throw new Error(`Generation did not complete: ${result.status}`);
  }
  if (!result.video?.url || new URL(result.video.url).protocol !== 'https:') {
    throw new Error('Completed response has no valid HTTPS video URL.');
  }
  return result.video.url;
}
