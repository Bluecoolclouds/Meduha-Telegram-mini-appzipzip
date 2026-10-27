export type TelegramApi = (method: string, parameters?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export class TelegramApiError extends Error {
  constructor(public status: number, public retryAfter = 5) {
    super('Telegram API request failed');
  }
}

/** Errors deliberately contain no request URL, credential or message contents. */
export function createTelegramApi(token: string): TelegramApi {
  return async (method, parameters = {}, signal) => {
    const multipart = Object.values(parameters).some(value => value instanceof Blob);
    const form = multipart ? new FormData() : null;
    if (form) for (const [key,value] of Object.entries(parameters)) {
      if (value instanceof Blob) form.append(key,value,key === 'video' ? 'video.mp4' : 'photo');
      else form.append(key,typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const timeout = AbortSignal.timeout(multipart ? 120_000 : method === 'getUpdates' ? 40_000 : 15_000);
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', ...(form ? {} : { headers: { 'Content-Type': 'application/json' } }),
      body: form ?? JSON.stringify(parameters),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch(() => { throw new TelegramApiError(0); });
    let data: { ok?: boolean; result?: unknown; error_code?: number; parameters?: { retry_after?: number } };
    try { data = await response.json() as typeof data; }
    catch { throw new TelegramApiError(response.status); }
    if (!response.ok || !data.ok) throw new TelegramApiError(data.error_code ?? response.status, data.parameters?.retry_after ?? 5);
    return data.result;
  };
}
