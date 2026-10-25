import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendGenjutsuTariffs, videoPolicyProblem } from './videoTariffs.ts';

test('Genjutsu matrix appends all 81 exact cells without replacing administrator prices', () => {
  const rates = ['480p', '720p', '1080p'].map((resolution, i) => ({
    scenario: 'genjutsu', resolution, exact: true, usdPerSecond: [0.318, 0.681, 1.632][i],
  }));
  const manual = { scenario: 'genjutsu', resolution: '720p', duration: 8, creditPrice: 7 };
  const tariffs = appendGenjutsuTariffs([manual], rates, 100);
  assert.equal(tariffs.length, 81);
  assert.deepEqual(tariffs.find(t => t.resolution === '720p' && t.duration === 8), manual);
  assert.equal(tariffs.find(t => t.resolution === '480p' && t.duration === 4)?.creditPrice, 128);
  assert.equal(tariffs.find(t => t.resolution === '1080p' && t.duration === 30)?.creditPrice, 4896);
  assert.deepEqual(appendGenjutsuTariffs(tariffs, rates, 100), tariffs);
  assert.deepEqual(appendGenjutsuTariffs([], rates.map(r => ({ ...r, scenario: 'restyle', exact: false })), 100), []);
  assert.throws(() => appendGenjutsuTariffs([], rates, 0));
});
test('Seedance price configuration must include both valid conversion and estimate ceiling', () => {
  const id = 'bytedance/seedance-2.5/text-to-video';
  assert.equal(videoPolicyProblem(id, {}), null);
  assert.equal(videoPolicyProblem(id, { videoCreditsPerUsd: 100, videoMaxUsd: 20 }), null);
  for (const config of [{ videoCreditsPerUsd: 100 }, { videoMaxUsd: 20 }, { videoCreditsPerUsd: 0, videoMaxUsd: 20 }]) {
    assert(videoPolicyProblem(id, config));
  }
  assert(videoPolicyProblem('other-model', { videoCreditsPerUsd: 100, videoMaxUsd: 20 }));
});
test('Kling Standard estimate configuration uses an explicit exchange rate and ceiling', () => {
  for (const mode of ['text-to-video', 'image-to-video']) {
    const id = `kling-video/v3.0/std/${mode}`;
    assert.equal(videoPolicyProblem(id, {}), null);
    assert.equal(videoPolicyProblem(id, { videoCreditsPerUsd: 100, videoMaxUsd: 20 }), null);
    assert(videoPolicyProblem(id, { videoMaxUsd: 20 }));
  }
  assert(videoPolicyProblem('kling-video/v3.0/pro/text-to-video', { videoCreditsPerUsd: 100, videoMaxUsd: 20 }));
});
