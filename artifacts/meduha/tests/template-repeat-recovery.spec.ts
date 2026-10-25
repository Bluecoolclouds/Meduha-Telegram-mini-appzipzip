import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startTemplateRepeatBrowserFixture } = require(
  '../../api-server/node_modules/.cache/meduha-template-repeat-browser/fixture.cjs',
) as {
  startTemplateRepeatBrowserFixture: () => Promise<{
    url: string;
    initData: string;
    accountId: string;
    sourceId: string;
    stop: () => Promise<void>;
  }>;
};

test('a published motion-transfer recipe becomes an account copy and restores edits and media after reload', async ({ page }) => {
  const fixture = await startTemplateRepeatBrowserFixture();
  const repeatedRequests: Record<string, any>[] = [];
  let telegramAuthenticated = false;
  try {
    await page.route('**/telegram-web-app.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.Telegram={WebApp:{
        initData:${JSON.stringify(telegramAuthenticated ? fixture.initData : '')},
        initDataUnsafe:{user:${telegramAuthenticated ? `{id:${JSON.stringify(fixture.accountId)}}` : 'undefined'}},
        platform:${JSON.stringify(telegramAuthenticated ? 'tdesktop' : 'unknown')},colorScheme:'light',themeParams:{},
        ready(){},expand(){},onEvent(){},offEvent(){},
        setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){}
      }};`,
    }));
    await page.route('**/api/meduha/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path === `/api/meduha/templates/${fixture.sourceId}/repeat`) {
        repeatedRequests.push(request.postDataJSON());
      }
      const upstream = await route.fetch({
        url: `${fixture.url}${path}${new URL(request.url()).search}`,
      });
      await route.fulfill({ response: upstream });
    });

    await page.goto(`/create?type=video&scenario=genjutsu&template=${fixture.sourceId}`);
    await expect(page.getByTestId('page-genjutsu-genjutsu')).toBeVisible();
    await expect(page.getByTestId('status-guest')).toBeVisible();
    await expect(page.getByTestId('input-genjutsu-prompt')).toHaveValue('Опубликованный промпт движения');
    await expect(page.getByTestId('button-resolution-1080p')).toHaveClass(/selected/);
    await expect(page.getByText('Видео шаблона', { exact: true })).toBeVisible();
    await expect(page.locator('.gj-photos img')).toHaveCount(1);
    expect(repeatedRequests).toHaveLength(0, 'guest preview must not create an account copy');

    // Reopening the same publication with signed Telegram launch data exercises
    // the real auth/bootstrap path before the account-owned copy is requested.
    telegramAuthenticated = true;
    await page.reload();
    await expect(page.getByTestId('status-guest')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('repeat')).toMatch(/^repeat-/);
    expect(new URL(page.url()).searchParams.has('template')).toBe(false);
    expect(repeatedRequests).toHaveLength(1);

    const repeatId = new URL(page.url()).searchParams.get('repeat')!;
    await page.getByTestId('input-genjutsu-prompt').fill('Мой изменённый промпт переноса');
    await page.getByTestId('button-resolution-480p').click();
    const storeKey = `meduha.genjutsu.repeat.v1.${fixture.accountId}.${repeatId}`;
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), storeKey))
      .toMatchObject({ prompt: 'Мой изменённый промпт переноса', resolution: '480p' });

    await page.reload();
    await expect(page.getByTestId('page-genjutsu-genjutsu')).toBeVisible();
    await expect(page.getByTestId('input-genjutsu-prompt')).toHaveValue('Мой изменённый промпт переноса');
    await expect(page.getByTestId('button-resolution-480p')).toHaveClass(/selected/);
    await expect(page.getByText('Видео шаблона', { exact: true })).toBeVisible();
    await expect(page.locator('.gj-photos img')).toHaveCount(1);
    await expect(page.getByTestId('video-source-preview')).toHaveAttribute('src', /\/api\/meduha\/media\//);
    expect(new URL(page.url()).searchParams.get('repeat')).toBe(repeatId);
    expect(repeatedRequests).toHaveLength(1, 'a reload must reopen the existing personal copy instead of copying again');
  } finally {
    await fixture.stop();
  }
});
