import test from 'node:test';
import assert from 'node:assert/strict';
import { photoIdeaHref, photoIdeaModel, photoIdeaParameters, photoIdeas, searchPhotoIdeas } from './ideas.ts';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../../../../api-server/src/lib/photo-catalog.json', import.meta.url)));

test('photo catalogue only references existing curated local image keys', () => {
  const approved = new Set(['fashion', 'portrait', 'perfume', 'flower', 'car', 'city', 'mountain', 'astronaut', 'wave']);
  assert.ok(photoIdeas.length >= 8);
  assert.ok(photoIdeas.every(idea => approved.has(idea.image)));
});

test('search finds useful terms and gives an empty set for unmatched text', () => {
  assert.equal(searchPhotoIdeas('парфюм')[0]?.id, 'perfume-campaign');
  assert.ok(searchPhotoIdeas('горы').some(idea => idea.id === 'mountain-route'));
  assert.deepEqual(searchPhotoIdeas('несуществующая идея'), []);
});

test('every idea opens a real generation model, never the draft-only editor', () => {
  for (const idea of photoIdeas) {
    const url = new URL(photoIdeaHref(idea), 'https://meduha.local');
    assert.equal(url.pathname, '/create');
    assert.equal(url.searchParams.get('type'), 'photo');
    assert.equal(url.searchParams.has('editor'), false);
    assert.equal(url.searchParams.get('photoIdea'), idea.id);
    assert.equal(url.searchParams.get('photoModel'), photoIdeaModel(idea));
    const model = catalog.models.find(model => model.id === photoIdeaModel(idea));
    assert.ok(model);
    assert.equal(photoIdeaParameters(idea, model.schema).prompt, idea.prompt);
  }
});

test('all documented modes can be selected without losing the scenario, including brief-only models', () => {
  const idea = photoIdeas[0];
  assert.equal(catalog.models.length, 20);
  for (const model of catalog.models) {
    const url = new URL(photoIdeaHref(idea, model.id), 'https://meduha.local');
    assert.equal(url.searchParams.get('photoIdea'), idea.id);
    assert.equal(url.searchParams.get('photoModel'), model.id);
    const parameters = photoIdeaParameters(idea, model.schema);
    assert.equal(parameters.prompt ?? parameters.brief, idea.prompt);
    assert.ok(Object.keys(parameters).every(key => key in model.schema.properties));
  }
});
