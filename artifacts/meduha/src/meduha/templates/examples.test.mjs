import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import motionTransfer from '@workspace/studio-examples/motion-transfer.json' with { type: 'json' };
import { recipeHref } from './recipe/model.ts';

const exampleSource = await readFile(new URL('./examples.ts', import.meta.url), 'utf8');

test('motion-transfer example is imported from the shared package, not public assets', () => {
  assert.match(exampleSource, /import motionTransfer from '@workspace\/studio-examples\/motion-transfer\.json';/);
  assert.doesNotMatch(exampleSource, /public\/templates\/motion-transfer\.json/);
});

test('public motion-transfer template matches the canonical studio example', async () => {
  const canonicalExample = JSON.parse(
    await readFile(new URL('../../../../../lib/studio-examples/motion-transfer.json', import.meta.url), 'utf8'),
  );
  const publicExample = JSON.parse(
    await readFile(new URL('../../../public/templates/motion-transfer.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(publicExample, canonicalExample);
});

test('motion-transfer recipe keeps its settings and opens the Genjutsu scenario', () => {
  assert.equal(motionTransfer.id, 'example-genjutsu-motion-transfer');
  assert.equal(motionTransfer.kind, 'video');
  assert.equal(motionTransfer.parameters.ratio, '9:16');
  assert.equal(motionTransfer.parameters.duration, '11');
  assert.equal(motionTransfer.recipe.catalogId, 'higgsfield/genjutsu/motion-transfer/v1.0');
  assert.equal(motionTransfer.recipe.parameters.resolution, '720p');
  assert.equal(motionTransfer.recipe.parameters.prompt, motionTransfer.prompt);
  assert.equal(
    recipeHref(motionTransfer.recipe, { template: motionTransfer.id }),
    '/create?type=video&scenario=genjutsu&template=example-genjutsu-motion-transfer',
  );
});
