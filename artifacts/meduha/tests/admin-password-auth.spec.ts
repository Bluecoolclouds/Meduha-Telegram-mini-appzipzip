import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startMeduhaAdminBrowserFixture } = require(
  '../../api-server/node_modules/.cache/meduha-admin-browser/fixture.cjs',
) as {
  startMeduhaAdminBrowserFixture: () => Promise<{
    url: string;
    credentials: { login: string; password: string };
    stop: () => Promise<void>;
  }>;
};

let fixture: Awaited<ReturnType<typeof startMeduhaAdminBrowserFixture>>;

test.beforeAll(async () => {
  fixture = await startMeduhaAdminBrowserFixture();
});

test.afterAll(async () => {
  await fixture?.stop();
});

async function assertPasswordWasNotStored(page: Page, password: string) {
  const browserState = await page.evaluate(() => ({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(JSON.stringify(browserState)).not.toContain(password);

  const cookies = await page.context().cookies();
  expect(cookies.some(cookie => cookie.value === password)).toBe(false);
}

test('admin password login, refresh, navigation and logout use the real router', async ({ page }) => {
  // The app itself is opened through the artifact router. Only its admin API
  // requests are forwarded to a real createMeduhaRouter instance with random credentials.
  await page.route('**/api/meduha/admin/**', async route => {
    const incoming = new URL(route.request().url());
    const upstream = await route.fetch({
      url: `${fixture.url}${incoming.pathname}${incoming.search}`,
    });
    await route.fulfill({ response: upstream });
  });

  const statusResponses: number[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/meduha/admin/login') {
      statusResponses.push(response.status());
    }
  });

  await page.goto('/admin');
  const loginInput = page.getByTestId('input-admin-login');
  const passwordInput = page.getByTestId('input-admin-password');
  await expect(loginInput).toHaveValue(fixture.credentials.login);
  await expect(passwordInput).toBeVisible();

  const unauthorized = await page.evaluate(async () => {
    const response = await fetch('/api/meduha/admin/channels');
    return response.status;
  });
  expect(unauthorized).toBe(403);

  await passwordInput.fill('incorrect-password');
  await page.getByTestId('button-password-login').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(passwordInput).toHaveValue('');
  await assertPasswordWasNotStored(page, 'incorrect-password');

  await passwordInput.fill(fixture.credentials.password);
  await page.getByTestId('button-password-login').click();
  await expect(page.getByTestId('nav-admin-overview')).toHaveAttribute('aria-current', 'page');
  await expect(passwordInput).toHaveCount(0);
  await assertPasswordWasNotStored(page, fixture.credentials.password);

  await page.reload();
  await expect(page.getByTestId('nav-admin-overview')).toHaveAttribute('aria-current', 'page');
  await assertPasswordWasNotStored(page, fixture.credentials.password);

  for (const section of ['config', 'users', 'finance', 'seedance', 'moderation', 'audit', 'overview']) {
    const tab = page.getByTestId(`nav-admin-${section}`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
  }

  await page.getByTestId('button-admin-logout').click();
  await expect(page.getByTestId('button-password-login')).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(passwordInput).toHaveValue('');

  const deniedAfterLogout = await page.evaluate(async () => {
    const response = await fetch('/api/meduha/admin/channels');
    return response.status;
  });
  expect(deniedAfterLogout).toBe(403);
  await assertPasswordWasNotStored(page, fixture.credentials.password);
  expect(statusResponses).toContain(200);
});
