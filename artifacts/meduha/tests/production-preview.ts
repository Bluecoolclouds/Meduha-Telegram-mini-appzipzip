import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/** Exercise built chunks without starting a duplicate application server.
 * API requests still reach the real artifact router; only static build files
 * are fulfilled from disk in this browser fixture.
 */
export async function useProductionPreview(page: Page, baseURL: string) {
  const root = fileURLToPath(new URL('../dist/public/', import.meta.url));
  const origin = new URL(baseURL).origin;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.continue();
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== path.resolve(root) && !file.startsWith(root)) return route.abort();
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return route.fulfill({ path: file });
    if (request.isNavigationRequest()) return route.fulfill({ path: path.join(root, 'index.html') });
    return route.fulfill({ status: 404, body: 'Build asset not found' });
  });
}
