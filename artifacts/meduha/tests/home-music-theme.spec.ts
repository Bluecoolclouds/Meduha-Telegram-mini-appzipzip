import { expect, test } from '@playwright/test';

test('music card keeps a dark surface and readable text in dark theme', async ({ page }) => {
  test.setTimeout(25_000);
  await page.setViewportSize({ width: 360, height: 860 });
  await page.goto('/');

  const themeToggle = page.locator('.m-theme-toggle');
  await expect(themeToggle).toBeVisible();
  if (await themeToggle.getAttribute('aria-pressed') === 'true') {
    await themeToggle.click();
  }
  await themeToggle.click();
  await expect(page.locator('.meduha.light')).toHaveClass(/dark/);

  const card = page.locator('.m-music-feature');
  await expect(card).toBeVisible();
  const colors = await card.evaluate((element) => {
    const icon = element.querySelector('.m-music-feature-icon')!;
    const title = element.querySelector('.m-music-feature-copy strong')!;
    const subtitle = element.querySelector('.m-music-feature-copy small')!;
    const arrow = element.querySelector('.m-music-feature-arrow')!;
    return {
      cardBackground: getComputedStyle(element).backgroundImage,
      cardBorder: getComputedStyle(element).borderTopColor,
      iconBackground: getComputedStyle(icon).backgroundImage,
      iconColor: getComputedStyle(icon).color,
      titleColor: getComputedStyle(title).color,
      subtitleColor: getComputedStyle(subtitle).color,
      arrowBackground: getComputedStyle(arrow).backgroundColor,
    };
  });

  expect(colors.cardBackground).toContain('linear-gradient');
  expect(colors.cardBorder).toBe('rgb(73, 59, 52)');
  expect(colors.iconBackground).toContain('linear-gradient');
  expect(colors.iconColor).toBe('rgb(255, 253, 251)');
  expect(colors.titleColor).toBe('rgb(246, 240, 235)');
  expect(colors.subtitleColor).toBe('rgb(196, 178, 163)');
  expect(colors.arrowBackground).toBe('rgb(52, 41, 34)');
});
