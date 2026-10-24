import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

export const SEEDANCE_MODEL = 'bytedance/seedance-2.5/text-to-video';
const HIGGSFIELD_API = 'https://api.higgsfield.ai';

// Replit Secrets stay server-side; local credentials are never browser env vars.
export function higgsfieldCredentials() {
  if (!process.env.higgsapi && !process.env.HF_API_KEY && !process.env.HF_CREDENTIALS && !process.env.higgs_api && !process.env.higgs) {
    loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  }
  const credentials = process.env.higgsapi || process.env.HF_API_KEY || process.env.HF_CREDENTIALS || process.env.higgs_api || process.env.higgs;
  if (!credentials || !/^\S+$/.test(credentials)) {
    throw new Error('Save the complete copied Higgsfield API key in higgsapi, HF_API_KEY, HF_CREDENTIALS, higgs or higgs_api.');
  }
  return credentials;
}

export type HiggsfieldSubmission = {
  status: string;
  request_id?: string;
  video?: { url?: string };
  images?: { url: string }[];
};

export async function submitHiggsfieldGeneration(
  endpoint: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<HiggsfieldSubmission> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(endpoint)
    || endpoint.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid Higgsfield model endpoint.');
  }
  // Send the complete copied credential unchanged. Never retry a billable POST:
  // a lost response does not prove that the upstream request was not accepted.
  const response = await fetcher(`${HIGGSFIELD_API}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${higgsfieldCredentials()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Higgsfield submission returned HTTP ${response.status}.`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string') {
    throw new Error('Higgsfield returned an invalid submission response.');
  }
  return result as HiggsfieldSubmission;
}

export async function getHiggsfieldRequestStatus(requestId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid Higgsfield request ID.');
  const response = await fetch(`${HIGGSFIELD_API}/requests/${encodeURIComponent(requestId)}/status`, {
    method: 'GET',
    headers: { Authorization: `Key ${higgsfieldCredentials()}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Higgsfield status request failed with HTTP ${response.status}.`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string') {
    throw new Error('Higgsfield returned an invalid request status.');
  }
  return result as { status: string; video?: { url?: string }; images?: { url: string }[] };
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
