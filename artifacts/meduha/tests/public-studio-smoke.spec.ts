import { expect, test } from '@playwright/test';
import { useProductionPreview } from './production-preview';

let productionPreview: Awaited<ReturnType<typeof useProductionPreview>> | null = null;

test.beforeEach(async ({ page, baseURL }) => {
  productionPreview = null;
  if (process.env.MEDUHA_PRODUCTION_SMOKE === '1') {
    productionPreview = await useProductionPreview(page, baseURL!);
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`public studio opens without runtime errors at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of ['/', '/create?type=photo', '/create?type=video', '/community', '/profile']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('.meduha')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      expect(await page.locator('body').evaluate(body =>
        body.scrollWidth <= window.innerWidth + 1), path).toBe(true);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('stale screen chunk offers a safe refresh and keeps saved drafts available', async ({ page }) => {
  test.skip(process.env.MEDUHA_PRODUCTION_SMOKE !== '1', 'Requires the production build preview.');
  test.setTimeout(60_000);

  const draft = {
    id: 'production-stale-chunk-draft',
    title: 'Сохранённая идея после обновления',
    type: 'photo',
    prompt: 'Сохранённый текст идеи после обновления приложения',
    style: 'Кино',
    model: 'Soul',
    ratio: '9:16',
    duration: '5 сек',
    updatedAt: Date.now(),
  };
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify([value]));
  }, { key: 'meduha.drafts.v1', value: draft });

  const sideEffectRequests: string[] = [];
  page.on('request', request => {
    if (
      request.method() !== 'GET' &&
      /\/api\/meduha\/(generations|wallet|payments|topups)/i.test(request.url())
    ) {
      sideEffectRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto('/create');
  await expect(page.locator('#meduha-prompt')).toBeVisible();
  await page.locator('#meduha-prompt').fill('Несохранённая идея, которую нельзя потерять молча');

  expect(productionPreview).not.toBeNull();
  productionPreview!.failNextChunk();
  await page.getByRole('link', { name: 'История' }).click();

  const recovery = page.getByTestId('chunk-load-recovery');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('Несохранённый текст не сохраняется автоматически');
  await expect(recovery).toContainText('Генерации и платежи автоматически не повторяются');
  await expect(page.getByTestId('button-refresh-after-chunk-error')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('meduha.drafts.v1'))).toContain(draft.prompt);
  expect(sideEffectRequests).toEqual([]);

  await page.getByTestId('button-refresh-after-chunk-error').click();
  await expect(page.getByRole('heading', { name: /Мои работы/ })).toBeVisible();
  await expect(page.getByText(draft.title)).toBeVisible();
  await page.getByRole('link', { name: `Изменить: ${draft.title}` }).click();
  await expect(page.locator('#meduha-prompt')).toHaveValue(draft.prompt);
  expect(sideEffectRequests).toEqual([]);
});

test('motion-transfer example really plays and supports seeking', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/create?type=video&scenario=genjutsu');
  const video = page.getByTestId('video-genjutsu-example');
  await expect(video).toBeVisible();
  await page.getByTestId('button-play-example').click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
    failed: element.error?.message ?? null,
    playing: !element.paused && element.currentTime > 0,
  })), { timeout: 30_000 }).toEqual({ failed: null, playing: true });
  await video.evaluate((element: HTMLVideoElement) => {
    element.pause();
    element.currentTime = Math.min(2, element.duration / 2);
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    !element.seeking && element.currentTime > 0 && element.error === null)).toBe(true);
});
