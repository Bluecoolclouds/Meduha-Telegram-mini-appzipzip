import { expect, test } from '@playwright/test';

test('a limit refusal keeps photo inputs and requires new calculation and explicit confirmation', async ({ page }) => {
  const response = await page.request.get('/api/meduha/photo/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  const catalogId = 'xai/grok-imagine-image-2.0';
  const modelId = '00000000-0000-4000-8000-000000000010';
  const referenceId = '00000000-0000-4000-8000-000000000011';
  const prompt = 'Тестовый портрет в мягком свете';
  const account = {
    id: '00000000-0000-4000-8000-000000000012',
    firstName: 'Fixture', lastName: null, username: null, photoUrl: null,
    languageCode: 'ru', credits: 100, subscription: 'free',
  };
  const quotes: Record<string, any>[] = [];
  const generations: Record<string, any>[] = [];
  const unexpectedMutations: string[] = [];

  // All auth, spending and mutation responses below exist only in this browser
  // fixture. Never enable real spending or send a generation to the server.
  await page.route('**/telegram-web-app.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram = { WebApp: {
      initData: 'browser-fixture-only', initDataUnsafe: { user: { id: ${JSON.stringify(account.id)} } },
      platform: 'tdesktop', colorScheme: 'light', themeParams: {},
      ready() {}, expand() {}, onEvent() {}, offEvent() {},
      setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}
    } };`,
  }));
  await page.route('**/api/meduha/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/meduha/session') {
      return route.fulfill({ json: { account, telegramConfigured: true } });
    }
    if (path === '/api/meduha/bootstrap') {
      return route.fulfill({ json: {
        account, drafts: [], works: [],
        settings: { theme: 'light', notifications: true },
      } });
    }
    if (path === '/api/meduha/photo/catalog') {
      return route.fulfill({ json: {
        ...catalog, spendingEnabled: true, providerConfigured: true, storageConfigured: true,
        models: catalog.models.map((model: { id: string }) => model.id === catalogId
          ? { ...model, modelId, available: true, creditPrice: 10, pricingBlockedReason: null }
          : model),
      } });
    }
    if (request.method() === 'POST' && path === '/api/meduha/photo/quote') {
      quotes.push(request.postDataJSON());
      return route.fulfill({ json: {
        token: `fixture-quote-${quotes.length}`, creditPrice: 10,
        expiresAt: Date.now() + 300_000, images: 1, referenceCount: 1,
        resolution: '1K', quality: 'standard', modelDailyLimit: 100, modelDailyRemaining: 100,
      } });
    }
    if (request.method() === 'POST' && path === '/api/meduha/photo/generations') {
      generations.push(request.postDataJSON());
      return route.fulfill({ status: 409, json: {
        code: 'DAILY_LIMIT_EXCEEDED', error: 'Дневной лимит изменился после расчёта',
      } });
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      unexpectedMutations.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 400, json: { error: 'Unexpected fixture mutation' } });
    }
    if (path === '/api/meduha/generations') return route.fulfill({ json: { jobs: [] } });
    if (path === `/api/meduha/media/${referenceId}`) {
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      });
    }
    return route.continue();
  });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: `meduha.photo.v1.${catalogId}`,
    value: JSON.stringify({
      params: { prompt }, json: {},
      refs: { image_urls: [{ id: referenceId, name: 'saved-reference.webp' }] },
    }),
  });
  await page.goto(`/create?type=photo&photoModel=${encodeURIComponent(catalogId)}`);
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
  await expect(confirm).toHaveCount(0);
  await expect(calculate).toBeEnabled();
  await expect(page.getByTestId('textarea-prompt')).toHaveValue(prompt);
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  expect(generations).toHaveLength(1);

  await calculate.click();
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('status-photo-daily-limit')).toHaveCount(0);
  expect(quotes).toHaveLength(2);
  expect(generations).toHaveLength(1);
  expect(quotes[1].parameters).toEqual(quotes[0].parameters);
  expect(quotes[1].references).toEqual({ image_urls: [referenceId] });
  expect(quotes[1].idempotencyKey).not.toBe(quotes[0].idempotencyKey);
  await confirm.click();
  await expect(page.getByTestId('status-photo-daily-limit')).toBeVisible();
  expect(generations).toHaveLength(2);
  expect(generations[1].priceQuote).toBe('fixture-quote-2');
  expect(generations[1].idempotencyKey).toBe(quotes[1].idempotencyKey);
  expect(unexpectedMutations).toEqual([]);
});
