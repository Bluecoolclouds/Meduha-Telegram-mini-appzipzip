import { expect, test } from '@playwright/test';

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
