import { expect, test } from '@playwright/test';

const catalogId = 'bytedance/seedance-2.5/text-to-video';
const accountId = 'browser-test-user';

test('Seedance estimate requires a fresh quote and explicit confirmation', async ({ page }) => {
  // Clone the real read-only catalog; readiness and estimate pricing exist only in this browser fixture.
  const response = await page.request.get('/api/meduha/video/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  catalog.spendingEnabled = true;
  catalog.providerConfigured = true;
  catalog.storageConfigured = true;
  const model = catalog.models.find((row: { id: string }) => row.id === catalogId);
  expect(model).toBeTruthy();
  expect(model.modelId).toBeTruthy();
  model.available = true;
  model.pricingMode = 'estimate';
  model.creditPrice = null;

  const quotes: Record<string, any>[] = [];
  const generations: Record<string, any>[] = [];
  const otherMutations: string[] = [];
  let quoteMode: 'success' | 'failure' | 'short-expiry' = 'success';

  await page.route('**/telegram-web-app.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{
      initData:'test-only-initdata',
      initDataUnsafe:{user:{id:${JSON.stringify(accountId)}}},
      platform:'tdesktop',colorScheme:'light',themeParams:{},
      ready(){},expand(){},onEvent(){},offEvent(){},
      setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){}
    }};`,
  }));
  await page.route('**/api/meduha/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      if (path === '/api/meduha/session') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          account: { id: accountId, credits: 1000, role: 'user' },
          telegramConfigured: true,
          telegramBotUsername: null,
        }) });
      }
      if (path === '/api/meduha/bootstrap') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          account: { id: accountId, credits: 1000 }, drafts: [], settings: {}, wallet: {},
        }) });
      }
      if (path === '/api/meduha/video/catalog') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
      }
      if (path === '/api/meduha/video/generations') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      }
      return route.continue();
    }
    if (request.method() === 'POST' && path === '/api/meduha/video/quote') {
      quotes.push(request.postDataJSON());
      if (quoteMode === 'failure') {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Fixture quote failure' }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          token: `fixture-quote-${quotes.length}`,
          creditPrice: 123,
          usdMicros: 1230000,
          expiresAt: Date.now() + (quoteMode === 'short-expiry' ? 2200 : 120000),
        }),
      });
    }
    if (request.method() === 'POST' && path === '/api/meduha/video/generations') {
      generations.push(request.postDataJSON());
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'fixture-job', status: 'queued' }),
      });
    }
    otherMutations.push(`${request.method()} ${path}`);
    return route.abort();
  });

  await page.goto(`/create?type=video&videoModel=${encodeURIComponent(catalogId)}`);
  await expect(page.getByTestId(`page-video-model-${catalogId}`)).toBeVisible();
  await expect(page.getByTestId('status-video-login-required')).toHaveCount(0);
  await page.getByTestId('textarea-prompt').fill('A calm cinematic test scene beside the sea.');

  await page.getByTestId('button-video-quote').click();
  await expect(page.getByTestId('text-video-cost')).toContainText('123');
  expect(quotes).toHaveLength(1);
  expect(generations).toHaveLength(0);

  await page.getByTestId('button-video-generate').click();
  await expect(page.getByTestId('dialog-video-confirm')).toBeVisible();
  await expect(page.getByTestId('text-confirm-price')).toHaveText('123');
  expect(generations).toHaveLength(0);
  await page.getByTestId('button-video-confirm').click();
  await expect.poll(() => generations.length).toBe(1);
  expect(generations[0]).toMatchObject({
    catalogId,
    modelId: model.modelId,
    expectedCreditPrice: 123,
    idempotencyKey: quotes[0].idempotencyKey,
    priceQuote: 'fixture-quote-1',
    parameters: quotes[0].parameters,
    references: quotes[0].references,
  });

  await page.getByTestId('input-duration').fill('10');
  await page.getByTestId('button-resolution-1080p').click();
  await expect(page.getByTestId('text-video-cost')).toContainText('Рассчитай цену');
  await expect(page.getByTestId('button-video-generate')).toHaveCount(0);
  expect(quotes).toHaveLength(1);
  expect(generations).toHaveLength(1);

  await page.getByTestId('button-video-quote').click();
  await expect(page.getByTestId('text-video-cost')).toContainText('123');
  expect(quotes).toHaveLength(2);
  await page.getByTestId('input-duration').fill('12');
  quoteMode = 'failure';
  await page.getByTestId('button-video-quote').click();
  await expect(page.getByTestId('text-video-error')).toContainText('Fixture quote failure');
  await expect(page.getByTestId('text-video-cost')).toContainText('Рассчитай цену');
  await expect(page.getByTestId('button-video-generate')).toHaveCount(0);
  expect(quotes).toHaveLength(3);
  expect(generations).toHaveLength(1);

  quoteMode = 'short-expiry';
  await page.getByTestId('button-video-quote').click();
  await expect(page.getByTestId('button-video-generate')).toBeVisible();
  await page.getByTestId('status-video-quote-expired').waitFor({ state: 'visible', timeout: 6000 });
  await expect(page.getByTestId('button-video-quote')).toBeVisible();
  await expect(page.getByTestId('button-video-generate')).toHaveCount(0);
  expect(generations).toHaveLength(1);

  quoteMode = 'success';
  await page.getByTestId('button-video-quote').click();
  await expect(page.getByTestId('button-video-generate')).toBeVisible();
  expect(generations).toHaveLength(1);
  expect(otherMutations).toEqual([]);
});

test('estimate can be calculated while global spending is off but creation stays blocked', async ({ page }) => {
  const response = await page.request.get('/api/meduha/video/catalog');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  catalog.spendingEnabled = false;
  catalog.providerConfigured = true;
  catalog.storageConfigured = true;
  const model = catalog.models.find((row: { id: string }) => row.id === catalogId);
  expect(model).toBeTruthy();
  model.available = true;
  model.pricingMode = 'estimate';
  model.creditPrice = null;

  const quotes: Record<string, any>[] = [];
  const generations: Record<string, any>[] = [];
  await page.route('**/telegram-web-app.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram={WebApp:{
      initData:'test-only-initdata',
      initDataUnsafe:{user:{id:${JSON.stringify(accountId)}}},
      platform:'tdesktop',colorScheme:'light',themeParams:{},
      ready(){},expand(){},onEvent(){},offEvent(){},
      setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){}
    }};`,
  }));
  await page.route('**/api/meduha/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      if (path === '/api/meduha/session') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          account: { id: accountId, credits: 1000, role: 'user' },
          telegramConfigured: true,
          telegramBotUsername: null,
        }) });
      }
      if (path === '/api/meduha/bootstrap') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          account: { id: accountId, credits: 1000 }, drafts: [], settings: {}, wallet: {},
        }) });
      }
      if (path === '/api/meduha/video/catalog') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
      }
      if (path === '/api/meduha/video/generations') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
      }
      return route.continue();
    }
    if (request.method() === 'POST' && path === '/api/meduha/video/quote') {
      quotes.push(request.postDataJSON());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'spending-off-fixture-quote',
          creditPrice: 123,
          usdMicros: 1230000,
          expiresAt: Date.now() + 120000,
        }),
      });
    }
    if (request.method() === 'POST' && path === '/api/meduha/video/generations') {
      generations.push(request.postDataJSON());
    }
    return route.abort();
  });

  await page.goto(`/create?type=video&videoModel=${encodeURIComponent(catalogId)}`);
  await expect(page.getByTestId(`page-video-model-${catalogId}`)).toBeVisible();
  await expect(page.getByTestId('status-video-login-required')).toHaveCount(0);
  await page.getByTestId('textarea-prompt').fill('A harmless browser-only pricing estimate.');

  const calculate = page.getByTestId('button-video-quote');
  await expect(calculate).toBeEnabled();
  await expect(page.getByTestId('status-video-spending-disabled'))
    .toHaveText('Смету можно рассчитать. Запуски и списания выключены.');
  await calculate.click();
  await expect(page.getByTestId('text-video-cost')).toContainText('123');
  await expect(page.getByTestId('button-video-generate')).toBeDisabled();
  expect(quotes).toHaveLength(1);
  expect(quotes[0]).toMatchObject({ catalogId, modelId: model.modelId });
  expect(generations).toHaveLength(0);
  expect(await page.getByTestId('dialog-video-confirm').count()).toBe(0);
});
