import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDrafts, packContentPlanPrompt, saveDrafts, unpackContentPlanPrompt } from '../studio.ts';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
globalThis.window = { dispatchEvent: () => true };

test('saved content-factory drafts reopen with their settings and video options', () => {
  const plan = { platform: 'TikTok', count: '10', format: 'Stories' };
  const draft = {
    id: 'content-plan-draft',
    title: 'Летняя коллекция',
    type: 'video',
    prompt: packContentPlanPrompt('Продвинуть летнюю коллекцию', plan),
    style: 'Студия',
    model: 'Контент-завод',
    ratio: '9:16',
    duration: '15 сек',
    updatedAt: 1,
  };

  assert.equal(saveDrafts([draft]), true);
  const reopened = loadDrafts().find(row => row.id === draft.id);
  assert.ok(reopened);
  assert.deepEqual(unpackContentPlanPrompt(reopened.prompt), {
    prompt: 'Продвинуть летнюю коллекцию',
    plan,
  });
  assert.equal(reopened.ratio, '9:16');
  assert.equal(reopened.duration, '15 сек');
});

test('older drafts without the content-plan marker reopen with safe defaults', () => {
  const oldPrompt = 'Продвинуть сезонную распродажу';
  const oldDraft = {
    id: 'legacy-content-plan-draft',
    title: 'Сезонная распродажа',
    type: 'video',
    prompt: oldPrompt,
    style: 'Студия',
    model: 'Контент-завод',
    ratio: '16:9',
    duration: '5 сек',
    updatedAt: 0,
  };

  assert.equal(saveDrafts([oldDraft]), true);
  const reopened = loadDrafts().find(row => row.id === oldDraft.id);
  assert.ok(reopened);
  assert.deepEqual(unpackContentPlanPrompt(reopened.prompt), {
    prompt: oldPrompt,
    plan: { platform: 'Instagram', count: '3', format: 'Короткое видео' },
  });
});
