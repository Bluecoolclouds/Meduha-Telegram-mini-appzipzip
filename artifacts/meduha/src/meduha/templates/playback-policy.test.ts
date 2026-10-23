import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackPolicy } from './playback-policy';

test('visible active pages allow at most two previews, low-core devices one', () => {
  assert.deepEqual(playbackPolicy({ pageActive: true, reducedMotion: false, hardwareConcurrency: 8 }), { pageActive: true, canAutoplay: true, previewLimit: 2 });
  assert.equal(playbackPolicy({ pageActive: true, reducedMotion: false, hardwareConcurrency: 4 }).previewLimit, 1);
  assert.equal(playbackPolicy({ pageActive: true, reducedMotion: false }).previewLimit, 2);
});
test('hidden pages, reduced motion, data saver and slow connections prevent autoplay', () => {
  for (const override of [{ pageActive: false }, { reducedMotion: true }, { saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
    assert.equal(playbackPolicy({ pageActive: true, reducedMotion: false, ...override }).canAutoplay, false);
  }
});
