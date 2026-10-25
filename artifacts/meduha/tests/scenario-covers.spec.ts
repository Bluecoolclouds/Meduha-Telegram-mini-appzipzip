import { expect, test } from '@playwright/test';
import photoCatalog from '../../api-server/src/lib/photo-catalog.json' with { type: 'json' };
import videoCatalog from '../../api-server/src/lib/video-catalog.json' with { type: 'json' };
import { groupFamilies } from '../src/meduha/photo/families';
import { photoIdeas } from '../src/meduha/photo/ideas';
import { videoScenarios } from '../src/meduha/video/scenarios';
import { photoIdeaCover, photoModelCover, videoModelCover, videoScenarioCover, type CoverSize } from '../src/meduha/scenarioCovers';

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test('optimized cards and carousel sizes load correctly, with large slides deferred until switching', async ({ page }) => {
  test.setTimeout(90_000);
  const cases: { path: string; covers: (size: CoverSize) => string[] }[] = [
    { path: '/create?type=photo', covers: size => groupFamilies(photoCatalog.models).map(group => photoModelCover(group.initial.id, size)) },
    { path: '/create?type=video', covers: size => videoCatalog.families.map(family => videoModelCover(family.modes[0], size)) },
    { path: '/create?type=video&ideas=1', covers: size => videoScenarios.map(scenario => videoScenarioCover(scenario.id, size)) },
    { path: '/create?type=photo&ideas=1', covers: size => photoIdeas.map(idea => photoIdeaCover(idea, size)) },
  ];
  for (const { path, covers } of cases) {
    const requested = new Set<string>();
    const observe = (request: { url(): string }) => requested.add(new URL(request.url()).pathname);
    page.on('request', observe);
    await page.goto(path);
    const cards = page.locator('.vs-grid .vs-card-img img');
    await expect(cards).toHaveCount(covers('card').length);
    expect(await cards.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(covers('card'));
    const heroes = covers('hero').slice(0, 5), thumbs = covers('thumb').slice(0, 5);
    const slides = page.locator('.vs-hero-slide > img');
    await expect(slides).toHaveCount(5);
    expect(await slides.evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual([heroes[0], ...thumbs.slice(1)]);
    expect(await page.locator('.vs-hero-thumbs img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(thumbs);
    for (let index = 0; index < 5; index++) {
      const source = new URL(index === 0 ? heroes[0] : thumbs[index], page.url()).href;
      await expect(page.locator('.vs-hero-backdrop').nth(index)).toHaveCSS('background-image', `url("${source}")`);
    }
    await expect.poll(() => slides.first().evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    const deferred = heroes.slice(1).find(url => url !== heroes[0]);
    if (deferred) expect(requested.has(deferred)).toBe(false);
    await page.locator('.vs-hero-thumbs button').nth(2).click();
    await expect(slides.nth(2)).toHaveAttribute('src', heroes[2]);
    await expect.poll(() => slides.nth(2).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.vs-grid video, .vs-hero video')).toHaveCount(0);
    expect([...requested].some(url => url.endsWith('.mp4') || url.endsWith('/app-icon.png'))).toBe(false);
    await expect(page.locator('.m-app-header .brand img')).toHaveAttribute('src', /app-icon-ui\.webp$/);
    page.off('request', observe);
  }
  await page.getByTestId(`card-photo-idea-${photoIdeas[0].id}`).click();
  await expect(page.locator('.vs-sheet-img')).toHaveAttribute('src', photoIdeaCover(photoIdeas[0], 'hero'));
  const image = await page.request.get(photoIdeaCover(photoIdeas[0]));
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/webp');
  expect(image.headers()['cache-control']).toContain('immutable');
  const head = await page.request.head(photoIdeaCover(photoIdeas[0]));
  expect(head.ok()).toBe(true);
  expect((await head.body()).length).toBe(0);
  const notModified = await page.request.get(photoIdeaCover(photoIdeas[0]), { headers: { 'If-None-Match': image.headers().etag } });
  expect(notModified.status()).toBe(304);
  const unknown = await page.request.get('/api/meduha/example-media/cover-unknown.webp');
  expect(unknown.status()).toBe(404);
});
