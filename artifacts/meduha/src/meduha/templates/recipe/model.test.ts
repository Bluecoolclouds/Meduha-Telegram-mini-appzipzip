import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldOfPointer, genjutsuModeOf, isRecipe, isRepeatId, pointerOf, recipeHref } from './model.ts';

test('recipe hrefs open the exact editor', () => {
  const r = { version: 1 as const, kind: 'video' as const, catalogId: 'higgsfield/genjutsu/motion-transfer/v1.0', parameters: {}, references: {} };
  assert.equal(recipeHref(r, { template: 't1' }), '/create?type=video&scenario=genjutsu&template=t1');
  assert.equal(recipeHref({ ...r, catalogId: 'kling/v2' }, { repeat: 'repeat-x' }), '/create?type=video&videoModel=kling%2Fv2&repeat=repeat-x');
  assert.equal(recipeHref({ ...r, kind: 'photo', catalogId: 'ideogram/v4.0' }, { template: 'a' }), '/create?type=photo&photoModel=ideogram%2Fv4.0&template=a');
  assert.equal(genjutsuModeOf('higgsfield/genjutsu/restyle/v1.0'), 'restyle');
});
test('pointers and ids', () => {
  assert.equal(pointerOf('image_urls'), '/image_urls');
  assert.equal(fieldOfPointer('/image_urls'), 'image_urls');
  assert.equal(fieldOfPointer('/a/0/b'), null);
  assert.ok(isRepeatId('repeat-0b6c9b1e-1111-4222-8333-444455556666'));
  assert.ok(!isRepeatId('draft-1'));
  assert.ok(!isRecipe({ version: 2 }));
});
