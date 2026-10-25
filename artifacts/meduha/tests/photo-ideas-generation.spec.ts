import { expect, test } from '@playwright/test';
import { photoIdeas, photoIdeaHref } from '../src/meduha/photo/ideas';
import catalog from '../../api-server/src/lib/photo-catalog.json' with { type: 'json' };
import previewMedia from '../src/meduha/photo/model-preview-media.json' with { type: 'json' };

test.use({ viewport: { width: 390, height: 844 } });

test('photo demo headers use matching Playground images in all 20 modes without duplicate cards', async ({ page }) => {
  test.setTimeout(80_000);
  await page.goto(photoIdeaHref(photoIdeas[0]));
  for (const model of catalog.models) {
    await page.getByTestId('select-photo-idea-model').selectOption(model.id);
    const form = page.getByTestId(`page-photo-model-${model.id}`);
    const expected = previewMedia.models[model.id as keyof typeof previewMedia.models];
    await expect(form.locator('.gj-ex-head h1')).toHaveCount(1);
    await expect(form.locator('.ps-model-head')).toHaveCount(0);
    await expect(form.locator('.gj-ex-media img')).toHaveAttribute('src', expected.image);
    await expect(form.locator('.gj-ex-media img')).toHaveAttribute('loading', 'lazy');
    await expect(form.locator('.gj-ex-media video')).toHaveCount(0);
    await expect(form.getByTestId('button-photo-quote')).toBeDisabled();
  }
  for (const id of ['higgsfield-ai/soul/v2/standard', 'higgsfield/ai-influencer', 'workflows/product-shots']) {
    await page.getByTestId('select-photo-idea-model').selectOption(id);
    const image = page.locator('.gj-ex-media img');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  }
});

test('all photo ideas open a prefilled generation form instead of a draft-only editor', async ({ page }) => {
  test.setTimeout(80_000);
  await page.goto('/create?type=photo&ideas=1');
  const first = photoIdeas[0];
  await page.getByTestId(`card-photo-idea-${first.id}`).click();
  await page.getByTestId(`button-use-photo-idea-${first.id}`).click();
  await expect(page.getByTestId('status-photo-idea')).toContainText(first.title);
  await expect(page.getByTestId('textarea-prompt')).toHaveValue(first.prompt);
  await expect(page.getByTestId('select-photo-idea-model').locator('option')).toHaveCount(20);
  await expect(page.getByTestId('button-photo-quote')).toBeDisabled();

  for (const idea of photoIdeas.slice(1)) {
    await page.goto(photoIdeaHref(idea));
    await expect(page.getByTestId('status-photo-idea')).toContainText(idea.title);
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(idea.prompt);
    await expect(page.getByTestId('button-photo-quote')).toBeDisabled();
  }
});

test('every documented mode accepts the idea through its own schema while spending stays disabled', async ({ page }) => {
  test.setTimeout(80_000);
  const idea = photoIdeas[0];
  await page.goto(photoIdeaHref(idea));
  const requests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/meduha/')) requests.push(request.url());
  });
  for (const model of catalog.models) {
    await page.getByTestId('select-photo-idea-model').selectOption(model.id);
    await expect(page.getByTestId(`page-photo-model-${model.id}`)).toBeVisible();
    await expect(page.getByTestId('status-photo-idea')).toContainText(idea.title);
    const field = 'prompt' in model.schema.properties ? 'prompt' : 'brief';
    await expect(page.getByTestId(`textarea-${field}`)).toHaveValue(idea.prompt);
    await expect(page.getByTestId('button-photo-quote')).toBeDisabled();
    expect(new URL(page.url()).searchParams.get('photoIdea')).toBe(idea.id);
  }
  expect(requests).toEqual([]);
});

test('scenario drafts keep edited prompts and references without overwriting ordinary model drafts', async ({ page }) => {
  const idea = photoIdeas.find(idea => idea.id === 'moon-garden')!;
  const modelId = 'xai/grok-imagine-image-2.0';
  const ordinaryKey = `meduha.photo.v1.${modelId}`;
  const scenarioKey = `${ordinaryKey}.idea.${idea.id}`;
  const refId = '00000000-0000-4000-8000-000000000001';
  const ordinaryDraft = JSON.stringify({ params: { prompt: 'Ordinary model draft' }, json: {}, refs: {} });
  await page.route(`**/api/meduha/media/${refId}`, route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  }));
  await page.goto('/');
  await page.evaluate(({ ordinaryKey, ordinaryDraft, scenarioKey, refId }) => {
    localStorage.setItem(ordinaryKey, ordinaryDraft);
    localStorage.setItem(scenarioKey, JSON.stringify({
      params: { prompt: 'Previously edited scenario' }, json: {},
      refs: { image_urls: [{ id: refId, name: 'saved-reference.webp' }] },
    }));
  }, { ordinaryKey, ordinaryDraft, scenarioKey, refId });
  await page.goto(photoIdeaHref(idea));
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Previously edited scenario');
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  await page.getByTestId('textarea-prompt').fill('Updated scenario description');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).params.prompt, scenarioKey))
    .toBe('Updated scenario description');
  await page.getByTestId('select-photo-idea-model').selectOption('ideogram/v4.0');
  await expect(page.getByTestId('textarea-prompt')).toHaveValue(idea.prompt);
  await page.getByTestId('select-photo-idea-model').selectOption(modelId);
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Updated scenario description');
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Updated scenario description');
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), ordinaryKey)).toBe(ordinaryDraft);
});

test('unknown scenario links fail explicitly instead of opening the wrong prompt', async ({ page }) => {
  await page.goto('/create?type=photo&photoModel=xai%2Fgrok-imagine-image-2.0&photoIdea=missing');
  await expect(page.getByText('Фото-сценарий не найден', { exact: true })).toBeVisible();
  await expect(page.getByTestId('button-photo-generate')).toHaveCount(0);
});
