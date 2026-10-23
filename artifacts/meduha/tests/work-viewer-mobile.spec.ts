import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';

const safeInsets = { top: 24, right: 0, bottom: 18, left: 0 };
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 640 },
];

async function openViewer(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await context.route('**/api/meduha/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: null, telegramConfigured: true, telegramBotUsername: null }),
  }));
  await context.route('**/api/meduha/templates**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], total: 0, nextCursor: null }),
  }));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: safeInsets });
  await page.goto('/community');
  const tile = page.getByTestId('card-template-example-space');
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page.getByTestId('detail-published-work')).toBeVisible();
  return { context, page, tile, cdp, errors };
}

async function assertSafeAreaAndLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'padding-top:env(safe-area-inset-top)',
      'padding-bottom:env(safe-area-inset-bottom)',
    ].join(';');
    document.body.append(probe);
    const safeTop = Number.parseFloat(getComputedStyle(probe).paddingTop);
    const safeBottom = Number.parseFloat(getComputedStyle(probe).paddingBottom);
    probe.remove();

    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      '.mw-top button, .mw-rail button, .mw-body .mw-remix, .m-nav a',
    )).map(element => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.getAttribute('aria-label') || element.textContent?.trim() || element.className,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      safeTop,
      safeBottom,
      topBarTop: document.querySelector<HTMLElement>('.mw-top')?.getBoundingClientRect().top ?? -1,
      controls,
    };
  });

  expect(layout.safeTop).toBeGreaterThanOrEqual(safeInsets.top);
  expect(layout.safeBottom).toBeGreaterThanOrEqual(safeInsets.bottom);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.topBarTop).toBeGreaterThanOrEqual(safeInsets.top);
  expect(layout.controls.length).toBeGreaterThan(5);
  for (const control of layout.controls) {
    expect(control.visible, `${control.name} should be visible`).toBe(true);
    expect(control.left, `${control.name} is clipped on the left`).toBeGreaterThanOrEqual(0);
    expect(control.top, `${control.name} is clipped at the top`).toBeGreaterThanOrEqual(0);
    expect(control.right, `${control.name} is clipped on the right`).toBeLessThanOrEqual(layout.viewportWidth);
    expect(control.bottom, `${control.name} is clipped at the bottom`).toBeLessThanOrEqual(layout.viewportHeight);
  }
}

async function swipe(cdp: CDPSession, startY: number, endY: number) {
  // Keep gestures clear of the action rail and the bottom prompt/remix buttons.
  const x = 40;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: endY, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

for (const viewport of viewports) {
  test(`fullscreen browsing works with safe areas at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const { context, page, tile, cdp, errors } = await openViewer(browser, viewport);

    try {
      await assertSafeAreaAndLayout(page);

      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('text-viewer-title')).toHaveText('Жизнь в деталях');
      await page.waitForTimeout(700);
      await page.keyboard.press('ArrowUp');
      await expect(page.getByTestId('text-viewer-title')).toHaveText('Другая вселенная');

      await page.waitForTimeout(700);
      await swipe(cdp, viewport.height * 0.42, viewport.height * 0.22);
      await expect(page.getByTestId('text-viewer-title')).toHaveText('Жизнь в деталях');
      await page.waitForTimeout(700);
      await swipe(cdp, viewport.height * 0.22, viewport.height * 0.42);
      await expect(page.getByTestId('text-viewer-title')).toHaveText('Другая вселенная');

      await page.getByTestId('button-copy-prompt').click();
      await expect(page.getByRole('status')).toContainText('Промпт скопирован');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('Астронавт на далёкой планете');
      await assertSafeAreaAndLayout(page);

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('detail-published-work')).toHaveCount(0);
      await expect(tile).toBeFocused();
      expect(errors, 'browser errors were logged').toEqual([]);
    } finally {
      await context.close();
    }
  });
}
