import { expect, test } from '@playwright/test';
import photoCatalog from '../../api-server/src/lib/photo-catalog.json' with { type: 'json' };
import videoCatalog from '../../api-server/src/lib/video-catalog.json' with { type: 'json' };
import { groupFamilies } from '../src/meduha/photo/families';
import { photoIdeas } from '../src/meduha/photo/ideas';
import { videoScenarios } from '../src/meduha/video/scenarios';
import { photoIdeaCover, photoModelCover, videoModelCover, videoScenarioCover } from '../src/meduha/scenarioCovers';

test.use({ viewport: { width: 390, height: 844 } });

test('photo and video catalogue cards, idea cards and all carousel images use the selected media', async ({ page }) => {
  test.setTimeout(80_000);
  const clipsRequested: string[] = [];
  page.on('request', request => {
    if (request.url().includes('.mp4')) clipsRequested.push(request.url());
  });
  const cases = [
    { path: '/create?type=photo', covers: groupFamilies(photoCatalog.models).map(group => photoModelCover(group.initial.id)) },
    { path: '/create?type=video', covers: videoCatalog.families.map(family => videoModelCover(family.modes[0])) },
    { path: '/create?type=video&ideas=1', covers: videoScenarios.map(scenario => videoScenarioCover(scenario.id)) },
    { path: '/create?type=photo&ideas=1', covers: photoIdeas.map(photoIdeaCover) },
  ];
  for (const { path, covers } of cases) {
    await page.goto(path);
    const cards = page.locator('.vs-grid .vs-card-img img');
    await expect(cards).toHaveCount(covers.length);
    expect(await cards.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(covers);
    const slides = page.locator('.vs-hero-slide > img');
    await expect(slides).toHaveCount(5);
    expect(await slides.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(covers.slice(0, 5));
    expect(await page.locator('.vs-hero-thumbs img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(covers.slice(0, 5));
    for (let index = 0; index < 5; index++) {
      await expect(page.locator('.vs-hero-backdrop').nth(index)).toHaveCSS('background-image', `url("${covers[index]}")`);
    }
    await expect.poll(() => slides.first().evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('.vs-grid video, .vs-hero video')).toHaveCount(0);
  }
  await page.getByTestId(`card-photo-idea-${photoIdeas[0].id}`).click();
  await expect(page.locator('.vs-sheet-img')).toHaveAttribute('src', photoIdeaCover(photoIdeas[0]));
  expect(clipsRequested).toEqual([]);
});
