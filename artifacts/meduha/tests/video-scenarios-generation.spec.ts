import { expect, test } from '@playwright/test';
import { scenarioDraftHref, videoScenarios } from '../src/meduha/video/scenarios';
import { videoScenarioGenerationHref } from '../src/meduha/video/scenarioGeneration';
import catalogue from '../../api-server/src/lib/video-catalog.json' with { type: 'json' };

test.use({ viewport: { width: 390, height: 844 } });

test('direct video scenarios and legacy scenario links open real prefilled generators', async ({ page }) => {
  for (const id of ['text-to-video', 'image-to-video', 'cinema']) {
    const scenario = videoScenarios.find(item => item.id === id)!;
    await page.goto(scenarioDraftHref(scenario, 'Мой ролик & сцена #1'));
    await expect(page.getByTestId('status-video-idea')).toContainText(scenario.title);
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(`${scenario.prompt}\n\nМоя задача: Мой ролик & сцена #1`);
    await expect(page.getByTestId('select-video-idea-model').locator('option')).toHaveCount(75);
    await expect(page.getByTestId('button-video-generate')).toBeDisabled();
    if (id === 'image-to-video') await expect(page.getByTestId('input-file-image_url')).toBeAttached();
  }
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('meduha.video.v2.guest.scenario.image-to-video.')) localStorage.removeItem(key);
  });
  await page.goto('/create?type=video&scenario=image-to-video&prompt=Legacy%20motion');
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Legacy motion');
  await expect(page.getByTestId('select-video-idea-model')).toBeVisible();
});

test('all 75 modes retain the scenario and use their own forms without sending paid requests', async ({ page }) => {
  test.setTimeout(150_000);
  const posts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/meduha\/(?:video\/generations|genjutsu|seedance)/.test(request.url())) posts.push(request.url());
  });
  const scenario = videoScenarios.find(item => item.id === 'text-to-video')!;
  await page.goto(scenarioDraftHref(scenario));
  for (const model of catalogue.models) {
    await page.getByTestId('select-video-idea-model').selectOption(model.id);
    await expect(page.getByTestId(`page-video-model-${model.id}`)).toBeVisible();
    await expect(page.getByTestId('status-video-idea')).toContainText(scenario.title);
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(scenario.prompt);
    await expect(page.getByTestId('button-video-generate')).toBeDisabled();
    expect(new URL(page.url()).searchParams.get('videoIdea')).toBe(scenario.id);
  }
  expect(posts).toEqual([]);
});

test('scenario-specific drafts restore edits and references without overwriting an ordinary model draft', async ({ page }) => {
  const scenario = videoScenarios.find(item => item.id === 'image-to-video')!;
  const modelId = 'bytedance/seedance-2.5/image-to-video';
  const key = `meduha.video.v2.guest.scenario.image-to-video.new.${modelId}`;
  const ordinaryKey = `meduha.video.v2.guest.${modelId}`;
  const ordinaryDraft = JSON.stringify({ params: { prompt: 'Ordinary model draft' }, json: {}, refs: {}, items: {} });
  await page.route('**/api/meduha/media/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' }));
  await page.goto('/create?type=video&ideas=1');
  await page.evaluate(({ key, ordinaryKey, ordinaryDraft }) => {
    localStorage.setItem(ordinaryKey, ordinaryDraft);
    localStorage.setItem(key, JSON.stringify({
      params: { prompt: 'Edited scenario motion' }, json: {}, items: {},
      refs: { '/image_url': [{ id: 'bce31cfb-6a9b-4ff4-a84a-625636ced273', name: 'saved-reference.webp', kind: 'image' }] },
    }));
  }, { key, ordinaryKey, ordinaryDraft });
  await page.goto(scenarioDraftHref(scenario));
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Edited scenario motion');
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  await page.getByTestId('textarea-prompt').fill('Updated scenario motion');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).params.prompt, key)).toBe('Updated scenario motion');
  await page.getByTestId('select-video-idea-model').selectOption('kling-video/v3.0/std/image-to-video');
  await expect(page.getByTestId('textarea-prompt')).toHaveValue(scenario.prompt);
  await page.getByTestId('select-video-idea-model').selectOption(modelId);
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Updated scenario motion');
  await expect(page.getByText('saved-reference.webp', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('textarea-prompt')).toHaveValue('Updated scenario motion');
  expect(await page.evaluate(key => localStorage.getItem(key), ordinaryKey)).toBe(ordinaryDraft);
});

test('composite workflows expose clearly labelled individual stages rather than fake full workflows', async ({ page }) => {
  for (const id of ['ai-blogger', 'katana', 'content-factory']) {
    const scenario = videoScenarios.find(item => item.id === id)!;
    await page.goto(scenarioDraftHref(scenario));
    if (id === 'ai-blogger') await expect(page.getByTestId('link-blogger-character')).toBeVisible();
    await page.locator('textarea').first().fill('Мой отдельный ролик');
    await page.getByTestId('button-scenario-generation').click();
    await expect(page.getByTestId('status-video-idea')).toContainText(scenario.title);
    await expect(page.getByTestId('textarea-prompt')).toHaveValue(/Мой отдельный ролик/);
    await expect(page.getByTestId('button-video-generate')).toBeDisabled();
    if (id === 'katana') {
      await expect(page.getByTestId('status-video-idea')).toContainText('не Katana');
      await expect(page.getByTestId('input-file-video_url')).toBeAttached();
    }
    if (id === 'content-factory') await expect(page.getByTestId('status-video-idea')).toContainText('одного ролика');
  }
});

test('saved draft identities and unsupported settings stay explicit; unknown scenarios fail closed', async ({ page }) => {
  const scenario = videoScenarios.find(item => item.id === 'cinema')!;
  const context = { prompt: 'A saved cinema scene', duration: '99 сек', draftId: 'draft-test-cinema' };
  await page.goto(videoScenarioGenerationHref(scenario, context));
  await expect(page.getByTestId('textarea-prompt')).toHaveValue(context.prompt);
  await expect(page.getByTestId('status-video-seed-settings')).toContainText('Длительность');
  await page.getByTestId('select-video-idea-model').selectOption('kling-video/v3.0/std/text-to-video');
  expect(new URL(page.url()).searchParams.get('videoDraft')).toBe(context.draftId);
  await page.goto('/create?type=video&videoModel=bytedance%2Fseedance-2.5%2Ftext-to-video&videoIdea=unknown');
  await expect(page.getByText('Видео-сценарий не найден', { exact: true })).toBeVisible();
});
