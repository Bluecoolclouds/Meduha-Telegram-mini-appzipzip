import { expect, test } from '@playwright/test';

test('homepage photo card rotates through its photos and remains linked to photo creation', async ({ page }) => {
  test.setTimeout(15_000);
  await page.goto('/');

  const preview = page.getByTestId('home-photo-preview');
  const currentPhoto = preview.getByTestId('home-photo-current');
  await expect(currentPhoto).toHaveAttribute('src', '/api/meduha/example-media/home-photo-1.webp');
  await expect.poll(() => currentPhoto.getAttribute('src'), {
    timeout: 10_000,
    intervals: [250, 500, 1000],
  }).toBe('/api/meduha/example-media/home-photo-2.webp');
  await expect(page.getByRole('link', { name: /Создать фото/ })).toHaveAttribute('href', '/create?type=photo');
});
