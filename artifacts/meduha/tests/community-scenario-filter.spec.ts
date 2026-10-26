import { expect, test } from '@playwright/test';

test('community scenario picker searches by partial words and applies a video filter', async ({ page }) => {
  await page.goto('/community');

  const filterButton = page.getByTestId('button-community-scenario-filter');
  await expect(filterButton).toBeVisible();
  await filterButton.click();

  const search = page.getByTestId('input-community-scenario-search');
  await expect(search).toBeVisible();
  await search.fill('джиудж');
  await expect(page.getByTestId('option-community-scenario-genjutsu')).toBeVisible();
  await expect(page.getByTestId('option-community-scenario-katana')).toHaveCount(0);

  await page.getByTestId('option-community-scenario-genjutsu').click();
  await expect(page).toHaveURL(/tag=genjutsu/);
  await expect(page).toHaveURL(/kind=video/);
  await expect(page.getByTestId('button-clear-community-scenario')).toBeVisible();
});
