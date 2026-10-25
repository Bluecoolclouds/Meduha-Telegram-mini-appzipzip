import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startMeduhaAdminBrowserFixture } = require(
  '../../api-server/node_modules/.cache/meduha-admin-browser/fixture.cjs',
) as {
  startMeduhaAdminBrowserFixture: (options: { includeTestAccount: true }) => Promise<{
    url: string;
    credentials: { login: string; password: string };
    testAccount?: { id: string; firstName: string; dailyLimit: number };
    stop: () => Promise<void>;
  }>;
};

let fixture: Awaited<ReturnType<typeof startMeduhaAdminBrowserFixture>>;

test.beforeAll(async () => {
  fixture = await startMeduhaAdminBrowserFixture({ includeTestAccount: true });
  if (!fixture.testAccount) throw new Error('The daily-usage fixture did not create its isolated test account.');
});

test.afterAll(async () => {
  await fixture?.stop();
});

async function assertDailyUsage(page: Page, values: { reserves: number; spent: number; limit: number; remaining: number }) {
  await expect(page.getByTestId('text-daily-reserves')).toHaveText(`${values.reserves} кр.`);
  await expect(page.getByTestId('text-daily-net-spent')).toHaveText(`${values.spent} кр.`);
  await expect(page.getByTestId('text-daily-limit')).toHaveText(`${values.limit} кр.`);
  await expect(page.getByTestId('text-daily-remaining')).toHaveText(`${values.remaining} кр.`);
}

async function setPageVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate(nextState => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => nextState,
    });
    window.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function fillReason(page: Page, reason: string) {
  await page.getByTestId('input-credit-reason').fill(reason);
}

async function reserveInUI(page: Page, amount: number) {
  await page.getByTestId('button-user-reserve').click();
  await page.getByTestId('input-credit-amount').fill(String(amount));
  await fillReason(page, 'Browser daily-usage regression reserve');
  await page.getByTestId('button-credit-review').click();
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/meduha/admin/credits/reserve'
    && response.request().method() === 'POST',
  );
  await page.getByTestId('button-credit-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json() as { reservation: { id: string } };
  expect(body.reservation.id).toBeTruthy();
  return body.reservation.id;
}

async function transitionInUI(page: Page, reservationId: string, action: 'release' | 'settle' | 'refund') {
  await page.getByTestId(`button-${action}-${reservationId}`).click();
  await fillReason(page, `Browser daily-usage regression ${action}`);
  await page.getByTestId('button-credit-review').click();
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/meduha/admin/credits/${reservationId}/${action}`
    && response.request().method() === 'POST',
  );
  await page.getByTestId('button-credit-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
}

async function mutateReservationThroughAPI(
  page: Page,
  userId: string,
  action: 'reserve',
  amount: number,
): Promise<string>;
async function mutateReservationThroughAPI(
  page: Page,
  userId: string,
  action: 'release' | 'settle' | 'refund',
  reservationId: string,
): Promise<void>;
async function mutateReservationThroughAPI(
  page: Page,
  userId: string,
  action: 'reserve' | 'release' | 'settle' | 'refund',
  value: number | string,
): Promise<string | void> {
  const body = action === 'reserve'
    ? {
      userId,
      amount: Number(value),
      reason: 'Browser daily-usage polling regression',
      idempotencyKey: `admin-browser-${randomUUID()}`,
      modelId: null,
      channelId: null,
    }
    : {
      reason: `Browser daily-usage regression ${action}`,
      idempotencyKey: `admin-browser-${randomUUID()}`,
    };
  const result = await page.evaluate(async ({ action, reservationId, body }) => {
    const url = action === 'reserve'
      ? '/api/meduha/admin/credits/reserve'
      : `/api/meduha/admin/credits/${encodeURIComponent(reservationId!)}/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Meduha-Request': '1' },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() as { reservation?: { id: string } } };
  }, { action, reservationId: action === 'reserve' ? undefined : value, body });
  expect(result.status).toBe(200);
  if (action === 'reserve') {
    const reservationId = result.payload.reservation?.id;
    expect(reservationId).toBeTruthy();
    return reservationId!;
  }
}

test('account daily usage refreshes through the real admin API and an isolated account', async ({ page }) => {
  test.setTimeout(75_000);
  const account = fixture.testAccount!;
  let walletFailuresRemaining = 0;
  let walletStaysUnavailable = false;
  let dailyUsageUtcDayOverride: string | null = null;
  await page.route('**/api/meduha/admin/**', async route => {
    const incoming = new URL(route.request().url());
    if (walletStaysUnavailable
      && incoming.pathname === '/api/meduha/admin/wallet'
      && incoming.searchParams.get('userId') === account.id
      && route.request().method() === 'GET') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary wallet read failure' }),
      });
      return;
    }
    if (walletFailuresRemaining > 0
      && incoming.pathname === '/api/meduha/admin/wallet'
      && incoming.searchParams.get('userId') === account.id
      && route.request().method() === 'GET') {
      walletFailuresRemaining -= 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary wallet read failure' }),
      });
      return;
    }
    const upstream = await route.fetch({
      url: `${fixture.url}${incoming.pathname}${incoming.search}`,
    });
    if (walletStaysUnavailable
      && incoming.pathname === '/api/meduha/admin/wallet'
      && incoming.searchParams.get('userId') === account.id
      && route.request().method() === 'GET') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary wallet read failure' }),
      });
      return;
    }
    if (dailyUsageUtcDayOverride
      && incoming.pathname === '/api/meduha/admin/wallet'
      && incoming.searchParams.get('userId') === account.id
      && route.request().method() === 'GET'
      && upstream.status() === 200) {
      const body = await upstream.json() as {
        dailyUsage?: Record<string, unknown>;
        [key: string]: unknown;
      };
      await route.fulfill({
        status: upstream.status(),
        contentType: 'application/json',
        body: JSON.stringify({
          ...body,
          dailyUsage: { ...body.dailyUsage, utcDay: dailyUsageUtcDayOverride },
        }),
      });
      return;
    }
    await route.fulfill({ response: upstream });
  });

  await page.goto('/admin');
  await page.getByTestId('input-admin-login').fill(fixture.credentials.login);
  await page.getByTestId('input-admin-password').fill(fixture.credentials.password);
  await page.getByTestId('button-password-login').click();
  await expect(page.getByTestId('nav-admin-overview')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('nav-admin-users').click();

  const search = page.getByTestId('input-user-search');
  await search.fill(account.firstName);
  const accountRow = page.getByTestId(`button-user-${account.id}`);
  await expect(accountRow).toBeVisible();
  walletFailuresRemaining = 10;
  const failedInitialWallet = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/meduha/admin/wallet'
      && new URL(response.url()).searchParams.get('userId') === account.id
      && response.request().method() === 'GET'
      && response.status() === 503,
  );
  await accountRow.click();
  const dailyUsage = page.getByTestId('account-daily-usage');
  await expect(dailyUsage).toBeVisible();
  await failedInitialWallet;
  await expect(dailyUsage.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(dailyUsage.getByTestId('button-retry')).toBeVisible();
  await expect(dailyUsage.getByTestId('text-daily-reserves')).toHaveCount(0);
  await expect(dailyUsage.getByTestId('text-daily-net-spent')).toHaveCount(0);
  await expect(dailyUsage.getByTestId('text-daily-limit')).toHaveCount(0);
  await expect(dailyUsage.getByTestId('text-daily-remaining')).toHaveCount(0);
  walletFailuresRemaining = 0;
  const recoveredInitialWallet = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as { dailyUsage?: { activeReserves?: number } };
    return body.dailyUsage?.activeReserves === 0;
  });
  await dailyUsage.getByTestId('button-retry').click();
  await recoveredInitialWallet;
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  const releasedReservation = await reserveInUI(page, 8);
  await assertDailyUsage(page, {
    reserves: 8, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 8,
  });
  await transitionInUI(page, releasedReservation, 'release');
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  const settledReservation = await reserveInUI(page, 8);
  await assertDailyUsage(page, {
    reserves: 8, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 8,
  });
  await transitionInUI(page, settledReservation, 'settle');
  await assertDailyUsage(page, {
    reserves: 0, spent: 8, limit: account.dailyLimit, remaining: account.dailyLimit - 8,
  });
  await transitionInUI(page, settledReservation, 'refund');
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  await page.getByTestId('nav-admin-overview').click();
  await page.getByTestId('nav-admin-users').click();
  await page.getByTestId('input-user-search').fill(account.firstName);
  const reopenedAccountRow = page.getByTestId(`button-user-${account.id}`);
  await expect(reopenedAccountRow).toBeVisible();
  await reopenedAccountRow.click();
  const previousUtcDay = '2026-10-24';
  const currentUtcDay = '2026-10-25';
  dailyUsageUtcDayOverride = previousUtcDay;
  const previousDayResponse = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as { dailyUsage?: { utcDay?: string } };
    return body.dailyUsage?.utcDay === previousUtcDay;
  });
  await page.getByTestId('button-refresh-daily-usage').click();
  await previousDayResponse;
  await expect(page.getByTestId('text-daily-usage-day')).toHaveText(`Дневной лимит · ${previousUtcDay} UTC`);

  dailyUsageUtcDayOverride = currentUtcDay;
  walletStaysUnavailable = true;
  const failedAcrossUtcMidnight = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/meduha/admin/wallet'
      && new URL(response.url()).searchParams.get('userId') === account.id
      && response.request().method() === 'GET'
      && response.status() === 503,
  );
  await page.getByTestId('button-refresh-daily-usage').click();
  await failedAcrossUtcMidnight;
  await expect(page.getByTestId('daily-usage-stale')).toBeVisible();
  await expect(page.getByTestId('text-daily-usage-day')).toHaveText(`Дневной лимит · ${previousUtcDay} UTC`);
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  walletStaysUnavailable = false;
  await expect(page.getByTestId('button-refresh-daily-usage')).toBeEnabled({ timeout: 15_000 });
  const recoveredAcrossUtcMidnight = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as { dailyUsage?: { utcDay?: string } };
    return body.dailyUsage?.utcDay === currentUtcDay;
  });
  await page.getByTestId('button-refresh-daily-usage').click();
  await recoveredAcrossUtcMidnight;
  await expect(page.getByTestId('text-daily-usage-day')).toHaveText(`Дневной лимит · ${currentUtcDay} UTC`);
  await expect(page.getByTestId('daily-usage-stale')).toHaveCount(0);

  dailyUsageUtcDayOverride = null;
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  const manuallyRefreshedReservation = await mutateReservationThroughAPI(page, account.id, 'reserve', 5);
  await expect(page.getByTestId('text-daily-reserves')).toHaveText('0 кр.', { timeout: 1_000 });
  walletFailuresRemaining = 1;
  const failedManualWallet = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/meduha/admin/wallet'
      && new URL(response.url()).searchParams.get('userId') === account.id
      && response.request().method() === 'GET'
      && response.status() === 503,
  );
  const recoveredManualWallet = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as { dailyUsage?: { activeReserves?: number } };
    return body.dailyUsage?.activeReserves === 5;
  });
  await page.getByTestId('button-refresh-daily-usage').click();
  await failedManualWallet;
  await expect(page.getByTestId('daily-usage-stale')).toBeVisible();
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });
  await recoveredManualWallet;
  await expect(page.getByTestId('daily-usage-stale')).toHaveCount(0);
  await assertDailyUsage(page, {
    reserves: 5, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 5,
  });
  await mutateReservationThroughAPI(page, account.id, 'release', manuallyRefreshedReservation);
  await page.getByTestId('button-refresh-daily-usage').click();
  await assertDailyUsage(page, {
    reserves: 0, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit,
  });

  const pollingResponse = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as { dailyUsage?: { activeReserves?: number } };
    return body.dailyUsage?.activeReserves === 4;
  }, { timeout: 40_000 });
  const focusSettledReservation = await mutateReservationThroughAPI(page, account.id, 'reserve', 4);
  const polledWallet = await pollingResponse;
  const polledBody = await polledWallet.json() as { dailyUsage: { activeReserves: number; remaining: number } };
  expect(polledBody.dailyUsage.activeReserves).toBe(4);
  expect(polledBody.dailyUsage.remaining).toBe(account.dailyLimit - 4);
  await assertDailyUsage(page, {
    reserves: 4, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 4,
  });

  const backgroundTab = await page.context().newPage();
  await backgroundTab.goto('about:blank');
  await backgroundTab.bringToFront();
  await setPageVisibility(page, 'hidden');
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');

  await mutateReservationThroughAPI(page, account.id, 'settle', focusSettledReservation);
  const backgroundReservation = await mutateReservationThroughAPI(page, account.id, 'reserve', 3);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await assertDailyUsage(page, {
    reserves: 4, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 4,
  });

  walletFailuresRemaining = 1;
  const failedFocusedWallet = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/meduha/admin/wallet'
      && new URL(response.url()).searchParams.get('userId') === account.id
      && response.request().method() === 'GET'
      && response.status() === 503,
  );
  const recoveredFocusedWallet = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/meduha/admin/wallet'
      || new URL(response.url()).searchParams.get('userId') !== account.id
      || response.request().method() !== 'GET'
      || response.status() !== 200) return false;
    const body = await response.json() as {
      dailyUsage?: { activeReserves?: number; netSpent?: number; remaining?: number };
    };
    return body.dailyUsage?.activeReserves === 3
      && body.dailyUsage.netSpent === 4
      && body.dailyUsage.remaining === account.dailyLimit - 7;
  });
  await page.bringToFront();
  await setPageVisibility(page, 'visible');
  await failedFocusedWallet;
  await expect(page.getByTestId('daily-usage-stale')).toBeVisible();
  await assertDailyUsage(page, {
    reserves: 4, spent: 0, limit: account.dailyLimit, remaining: account.dailyLimit - 4,
  });
  const refreshedWallet = await recoveredFocusedWallet;
  await expect(page.getByTestId('daily-usage-stale')).toHaveCount(0);
  const refreshedBody = await refreshedWallet.json() as {
    dailyUsage: { activeReserves: number; netSpent: number; remaining: number };
  };
  expect(refreshedBody.dailyUsage).toMatchObject({
    activeReserves: 3,
    netSpent: 4,
    remaining: account.dailyLimit - 7,
  });
  await assertDailyUsage(page, {
    reserves: 3, spent: 4, limit: account.dailyLimit, remaining: account.dailyLimit - 7,
  });

  await mutateReservationThroughAPI(page, account.id, 'release', backgroundReservation);
  await mutateReservationThroughAPI(page, account.id, 'refund', focusSettledReservation);
  await backgroundTab.close();
});
