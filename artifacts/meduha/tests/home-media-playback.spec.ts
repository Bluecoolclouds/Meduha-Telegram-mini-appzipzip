import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const localVideo = fileURLToPath(new URL('../../../scripts/assets/home-video.mp4', import.meta.url));
const localPoster = fileURLToPath(new URL('../public/images/brand/mascot-hello.webp', import.meta.url));
const fixtureId = 'browser-video-fixture';
const fixtureVideoUrl = '/api/meduha/media/00000000-0000-0000-0000-000000000001';
const mediaRequests: string[] = [];
const apiRequests: string[] = [];
const abortedMediaRequests: string[] = [];

const templateFixture = {
  id: fixtureId,
  status: 'published',
  kind: 'video',
  title: 'Локальное тестовое видео',
  description: 'Изолированный браузерный тест.',
  poster: fixtureVideoUrl,
  videoUrl: fixtureVideoUrl,
  width: 16,
  height: 9,
  prompt: 'Локальное тестовое видео.',
  tags: [],
  parameters: { model: '', style: '', ratio: '16:9', duration: '5' },
  authorName: 'Тест',
  authorAvatarUrl: null,
  likeCount: 0,
  likedByMe: false,
  savedByMe: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function installLocalMediaAndApi(
  context: BrowserContext,
  page: Page,
  beforeVideoResponse?: (pathname: string) => Promise<void>,
) {
  mediaRequests.length = 0;
  apiRequests.length = 0;
  abortedMediaRequests.length = 0;
  page.on('request', request => {
    if (request.url().endsWith('.mp4') || request.url().includes('/preview')) {
      mediaRequests.push(new URL(request.url()).pathname);
    }
  });
  page.on('requestfailed', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/feed-media/') && pathname.endsWith('/preview')) {
      abortedMediaRequests.push(pathname);
    }
  });

  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/meduha/session') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ account: null, telegramConfigured: false, telegramBotUsername: null }),
      });
      return;
    }
    if (pathname === '/api/meduha/templates' && route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [templateFixture], total: 1, nextCursor: null }),
      });
      return;
    }
    if ((pathname.startsWith('/api/meduha/example-media/') && pathname.endsWith('.mp4'))
      || (pathname.startsWith('/api/meduha/feed-media/') && pathname.endsWith('/preview'))) {
      apiRequests.push(pathname);
      await beforeVideoResponse?.(pathname);
      try {
        await route.fulfill({ path: localVideo, contentType: 'video/mp4' });
      } catch (error) {
        if (!route.request().failure()) throw error;
      }
      return;
    }
    if (pathname.startsWith('/api/meduha/example-media/')
      || (pathname.startsWith('/api/meduha/feed-media/') && pathname.endsWith('/thumb'))) {
      apiRequests.push(pathname);
      await route.fulfill({ path: localPoster, contentType: 'image/webp' });
      return;
    }
    apiRequests.push(`UNEXPECTED ${route.request().method()} ${pathname}`);
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unexpected API request in isolated browser test"}' });
  });
}

async function setPageHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function centerInFeedScrollRoot(card: ReturnType<Page['getByTestId']>) {
  await card.evaluate(node => {
    const root = node.closest('.m-scroll');
    if (!root) throw new Error('Template card is missing its feed scroll root');
    const cardRect = node.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    root.scrollTop += cardRect.top - rootRect.top - (root.clientHeight - node.clientHeight) / 2;
  });
}

async function expectOnlyFixtureApi() {
  expect(apiRequests.filter(path => path.startsWith('UNEXPECTED'))).toEqual([]);
}

function fixturePreviewRequests() {
  return mediaRequests.filter(path => path.includes(`/feed-media/${fixtureId}/preview`));
}

test('homepage video waits for visibility and policy, then stops on page/card hide', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 220 });
  await installLocalMediaAndApi(context, page);
  await page.goto('/');

  const homeVideo = page.locator('.m-entry-video');
  await expect(homeVideo).toHaveCount(1);
  await expect.poll(() => mediaRequests.length).toBe(0);
  await expect(homeVideo).not.toHaveAttribute('src', /.+/);

  await homeVideo.scrollIntoViewIfNeeded();
  await expect.poll(() => mediaRequests.filter(path => path.endsWith('/home-video.mp4')).length).toBe(1);
  await expect.poll(() => homeVideo.evaluate(video => !video.paused && video.readyState >= 2)).toBe(true);

  await setPageHidden(page, true);
  await expect.poll(() => homeVideo.evaluate(video => video.paused && !video.hasAttribute('src'))).toBe(true);
  expect(mediaRequests.filter(path => path.endsWith('/home-video.mp4'))).toHaveLength(1);

  await setPageHidden(page, false);
  await expect.poll(() => mediaRequests.filter(path => path.endsWith('/home-video.mp4')).length).toBe(2);
  await expect.poll(() => homeVideo.evaluate(video => !video.paused)).toBe(true);

  await page.locator('.m-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => homeVideo.evaluate(video => video.paused && !video.hasAttribute('src'))).toBe(true);
  expect(mediaRequests.filter(path => path.endsWith('/home-video.mp4'))).toHaveLength(2);
  await expectOnlyFixtureApi();
});

test('template feed previews load only for visible allowed tiles and stop when hidden', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 260 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installLocalMediaAndApi(context, page);
  await page.goto('/community');
  await page.getByTestId('input-community-search').fill(templateFixture.title);

  const tile = page.getByTestId(`card-template-${fixtureId}`);
  await expect(tile).toBeAttached();
  await expect(page.locator('[data-testid^="card-template-"]')).toHaveCount(1);
  expect(mediaRequests).toEqual([]);
  await page.locator('.m-scroll').evaluate(root => {
    const spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = '1200px';
    root.append(spacer);
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await centerInFeedScrollRoot(tile);
  const video = tile.locator('video');
  await expect(video).toBeAttached();
  await expect.poll(() => fixturePreviewRequests().length).toBe(1);
  await expect.poll(() => video.evaluate(element => !element.paused && element.readyState >= 2)).toBe(true);

  const cardVideo = await video.elementHandle();
  await page.locator('.m-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(video).toHaveCount(0);
  await expect.poll(() => cardVideo!.evaluate(element => element.paused && !element.hasAttribute('src'))).toBe(true);
  const afterCardHideCount = fixturePreviewRequests().length;
  await page.waitForTimeout(400);
  expect(fixturePreviewRequests()).toHaveLength(afterCardHideCount);

  await centerInFeedScrollRoot(tile);
  await expect(video).toBeAttached();
  await expect.poll(() => video.evaluate(element => !element.paused && element.readyState >= 2)).toBe(true);
  const pageVideo = await video.elementHandle();
  const beforePageHideCount = fixturePreviewRequests().length;
  await setPageHidden(page, true);
  await expect(video).toHaveCount(0);
  await expect.poll(() => pageVideo!.evaluate(element => element.paused && !element.hasAttribute('src'))).toBe(true);
  await page.waitForTimeout(400);
  expect(fixturePreviewRequests()).toHaveLength(beforePageHideCount);
  await expectOnlyFixtureApi();
});

test('hiding a card cancels its still-pending preview request', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 260 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const responseGate = deferred();
  const responseStarted = deferred();
  await installLocalMediaAndApi(context, page, async pathname => {
    if (pathname.includes(`/feed-media/${fixtureId}/preview`)) {
      responseStarted.resolve();
      await responseGate.promise;
    }
  });

  try {
    await page.goto('/community');
    await page.getByTestId('input-community-search').fill(templateFixture.title);
    const tile = page.getByTestId(`card-template-${fixtureId}`);
    await expect(tile).toBeAttached();
    await expect(page.locator('[data-testid^="card-template-"]')).toHaveCount(1);
    await page.locator('.m-scroll').evaluate(root => {
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.height = '1200px';
      root.append(spacer);
    });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await centerInFeedScrollRoot(tile);
    await expect(tile.locator('video')).toBeAttached();
    await responseStarted.promise;
    await expect.poll(() => mediaRequests.filter(path => path.includes(`/feed-media/${fixtureId}/preview`)).length).toBe(1);

    await setPageHidden(page, true);
    await expect(tile.locator('video')).toHaveCount(0);
    await expect.poll(() => abortedMediaRequests).toContain(`/api/meduha/feed-media/${fixtureId}/preview`);
    await expectOnlyFixtureApi();
  } finally {
    responseGate.resolve();
    await context.close();
  }
});

for (const policy of ['Save-Data', 'reduced motion'] as const) {
  test(`homepage and feed never fetch video with ${policy} enabled`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 260 },
      ...(policy === 'reduced motion' ? { reducedMotion: 'reduce' as const } : {}),
    });
    if (policy === 'Save-Data') {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          get: () => ({ saveData: true, effectiveType: '4g' }),
        });
      });
    }
    const page = await context.newPage();
    try {
      await installLocalMediaAndApi(context, page);
      await page.goto('/');

      const homeVideo = page.locator('.m-entry-video');
      await homeVideo.scrollIntoViewIfNeeded();
      await expect(homeVideo).toHaveCount(1);
      await expect(homeVideo).not.toHaveAttribute('src', /.+/);
      await page.getByTestId(`card-template-${fixtureId}`).scrollIntoViewIfNeeded();
      await expect(page.getByTestId(`card-template-${fixtureId}`).locator('video')).toHaveCount(0);
      expect(mediaRequests).toEqual([]);
      await expectOnlyFixtureApi();
    } finally {
      await context.close();
    }
  });
}
