import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startPhotoLimitBrowserFixture } = require(
  '../../api-server/node_modules/.cache/meduha-photo-limit-browser/fixture.cjs',
) as {
  startPhotoLimitBrowserFixture: (catalog: Record<string, any>) => Promise<{
    url: string;
    initData: string;
    accountId: string;
    stop: () => Promise<void>;
  }>;
};

test('a limit refusal keeps photo inputs and requires new calculation and explicit confirmation', async ({ page }) => {
  const response = await page.request.get('/api/meduha/photo/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  const fixture = await startPhotoLimitBrowserFixture(catalog);
  const catalogId = 'xai/grok-imagine-image-2.0';
  const referenceId = '00000000-0000-4000-8000-000000000011';
  const prompt = 'Тестовый портрет в мягком свете';
  const quotes: Record<string, any>[] = [];
  const generations: Record<string, any>[] = [];
  const generationResponses: { status: number; code: string }[] = [];
  const otherMutations: string[] = [];
  let generationResponseCount = 0;
  try {
    await page.route('**/telegram-web-app.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.Telegram = { WebApp: {
        initData: ${JSON.stringify(fixture.initData)},
        initDataUnsafe: { user: { id: ${JSON.stringify(fixture.accountId)} } },
        platform: 'tdesktop', colorScheme: 'light', themeParams: {},
        ready() {}, expand() {}, onEvent() {}, offEvent() {},
        setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}
      } };`,
    }));
    await page.route('**/api/meduha/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path === '/api/meduha/photo/quote') quotes.push(request.postDataJSON());
      if (request.method() === 'POST' && path === '/api/meduha/photo/generations') {
        generations.push(request.postDataJSON());
        generationResponseCount++;
      }
      if (request.method() !== 'GET' && request.method() !== 'HEAD'
        && !['/api/meduha/auth/telegram', '/api/meduha/photo/quote', '/api/meduha/photo/generations'].includes(path)) {
        otherMutations.push(`${request.method()} ${path}`);
      }
      const upstream = await route.fetch({
        url: `${fixture.url}${path}${new URL(request.url()).search}`,
      });
      if (request.method() === 'POST' && path === '/api/meduha/photo/generations') {
        const body = await upstream.json() as { code: string };
        generationResponses.push({ status: upstream.status(), code: body.code });
      }
      await route.fulfill({ response: upstream });
    });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: `meduha.photo.v1.${catalogId}`,
      value: JSON.stringify({
        params: { prompt }, json: {},
        refs: { image_urls: [{ id: referenceId, name: 'saved-reference.webp' }] },
      }),
    });
    await page.goto(`/create?type=photo&photoModel=${encodeURIComponent(catalogId)}`);
    await expect(page.getByTestId(`page-photo-model-${catalogId}`)).toBeVisible();
    await expect(page.getByTestId('status-login-required')).toHaveCount(0);
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(prompt);
    await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
    const calculate = page.getByTestId('button-photo-quote');
    await expect(calculate).toBeEnabled();
    await calculate.click();
    const confirm = page.getByTestId('button-photo-generate');
    await expect(confirm).toBeEnabled();
    expect(quotes).toHaveLength(1);
    expect(generations).toHaveLength(0);
    await confirm.click();
    await expect(page.getByTestId('status-photo-daily-limit')).toBeVisible();
    await expect(page.getByTestId('status-photo-daily-limit')).toContainText('Дневного лимита не хватает');
    await expect(confirm).toHaveCount(0);
    await expect(calculate).toBeEnabled();
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(prompt);
    await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
    await page.waitForTimeout(350);
    await expect(page.getByTestId('status-photo-daily-limit')).toBeVisible();
    expect(generations).toHaveLength(1, 'a daily-limit refusal must not trigger an automatic POST retry');

    await calculate.click();
    await expect(confirm).toBeEnabled();
    await expect(page.getByTestId('status-photo-daily-limit')).toHaveCount(0);
    expect(quotes).toHaveLength(2);
    expect(generations).toHaveLength(1, 'recalculation must not submit a generation without explicit confirmation');
    expect(quotes[1].parameters).toEqual(quotes[0].parameters);
    expect(quotes[1].references).toEqual({ image_urls: [referenceId] });
    expect(quotes[1].idempotencyKey).not.toBe(quotes[0].idempotencyKey);
    await confirm.click();
    await expect.poll(() => generationResponseCount).toBe(2);
    await expect(page.getByTestId('status-photo-daily-limit')).toHaveCount(0);
    expect(generations).toHaveLength(2);
    expect(generations[1].priceQuote).toBe(`fixture-quote-${quotes[1].idempotencyKey}`);
    expect(generations[1].idempotencyKey).toBe(quotes[1].idempotencyKey);
    expect(generationResponses).toEqual([
      { status: 409, code: 'DAILY_LIMIT_EXCEEDED' },
      { status: 409, code: 'INSUFFICIENT_CREDITS' },
    ]);
    expect(otherMutations).toEqual([]);
  } finally {
    await fixture.stop();
  }
});
