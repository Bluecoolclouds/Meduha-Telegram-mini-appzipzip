import { expect, test } from '@playwright/test';

const planBrief = [
  'Подготовить подробную серию коротких роликов о запуске новой сезонной коллекции.',
  'Показать разные способы сочетания вещей, рассказать о материалах и дать зрителю понятный призыв к действию.',
].join('\n\n').repeat(5);
const longReferenceName = `${'collection-reference-'.repeat(6)}final.jpg`;

const drafts = [
  {
    id: 'phone-content-plan',
    title: 'Контент-план на запуск коллекции',
    type: 'video',
    prompt: [
      planBrief,
      '',
      'Параметры контент-плана Meduha:',
      `Площадка: ${'SocialPlatformName '.repeat(5)}`,
      'Идей: 10',
      `Формат: ${'Short-form vertical video '.repeat(4)}`,
    ].join('\n'),
    style: 'Студия',
    model: 'Контент-завод',
    ratio: '9:16',
    duration: '15 сек',
    updatedAt: 1,
    referenceName: longReferenceName,
  },
  {
    id: 'phone-ordinary-video',
    title: 'Обычный видео-сценарий',
    type: 'video',
    prompt: `${planBrief}\n\nПараметры контент-плана Meduha:\nПлощадка: TikTok\nИдей: 10\nФормат: Stories`,
    style: 'Кинематографичный',
    model: 'Seedance 2.5',
    ratio: '16:9',
    duration: '5 сек',
    updatedAt: 2,
    referenceName: longReferenceName,
  },
];

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 640 },
]) {
  test(`saved video details remain readable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(rows => {
      localStorage.setItem('meduha.drafts.v1', JSON.stringify(rows));
    }, drafts);
    await page.route('**/api/meduha/session', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ account: null, telegramConfigured: true, telegramBotUsername: null }),
    }));
    await page.goto('/works');

    for (const draft of drafts) {
      await page.getByRole('button', { name: `Открыть черновик: ${draft.title}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Черновик идеи' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(
        draft.id === 'phone-content-plan' ? planBrief : draft.prompt,
        { exact: true },
      )).toBeVisible();

      const layout = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const actions = element.querySelector<HTMLElement>('.m-dialog-actions')!;
        const actionRect = actions.getBoundingClientRect();
        const overflowing = [...element.querySelectorAll<HTMLElement>('*')]
          .filter(child => {
            const childRect = child.getBoundingClientRect();
            return child.scrollWidth > child.clientWidth + 1
              && childRect.width > 0
              && getComputedStyle(child).overflowX === 'visible';
          })
          .map(child => child.className || child.tagName);
        return {
          sheet: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          actions: { left: actionRect.left, right: actionRect.right, top: actionRect.top, bottom: actionRect.bottom },
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowing,
        };
      });

      expect(layout.sheet.left).toBeGreaterThanOrEqual(0);
      expect(layout.sheet.right).toBeLessThanOrEqual(viewport.width);
      expect(layout.actions.left).toBeGreaterThanOrEqual(layout.sheet.left);
      expect(layout.actions.right).toBeLessThanOrEqual(layout.sheet.right);
      expect(layout.overflowing).toEqual([]);

      await dialog.getByRole('link', { name: /Редактировать/ }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('link', { name: /Редактировать/ })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Удалить' })).toBeVisible();
      const actionBounds = await dialog.locator('.m-dialog-actions').evaluate(element => {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top, bottom, left, right };
      });
      expect(actionBounds.top).toBeGreaterThanOrEqual(0);
      expect(actionBounds.bottom).toBeLessThanOrEqual(viewport.height);
      expect(actionBounds.left).toBeGreaterThanOrEqual(0);
      expect(actionBounds.right).toBeLessThanOrEqual(viewport.width);
      if (draft.id === 'phone-content-plan') {
        const planSettings = dialog.locator('.m-info-note').first();
        await expect(planSettings).toContainText('Площадка: SocialPlatformName');
        await expect(planSettings).toContainText('Идей: 10');
        await expect(planSettings).toContainText('Формат: Short-form vertical video');
      } else {
        await expect(dialog.getByText(draft.prompt, { exact: true })).toBeVisible();
        await expect(dialog.getByText(/Площадка: TikTok/)).toBeVisible();
      }
      await page.getByRole('button', { name: 'Закрыть' }).click();
    }
  });
}
