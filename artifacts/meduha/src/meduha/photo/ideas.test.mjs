import test from 'node:test';
import assert from 'node:assert/strict';
import { photoIdeaHref, photoIdeaModel, photoIdeaParameters, photoIdeas, searchPhotoIdeas } from './ideas.ts';
import { readFileSync } from 'node:fs';
import { photoModelPreview } from './modelPreviews.ts';
import { photoIdeaCover, photoModelCover, videoModelCover, videoScenarioCover } from '../scenarioCovers.ts';
import { videoScenarios } from '../video/scenarios.ts';

const catalog = JSON.parse(readFileSync(new URL('../../../../api-server/src/lib/photo-catalog.json', import.meta.url)));

test('catalogue covers use matching photo examples and video posters, not illustration keys or video files', () => {
  for (const model of catalog.models) assert.equal(photoModelCover(model.id), photoModelPreview(model.id).image);
  for (const idea of photoIdeas) assert.equal(photoIdeaCover(idea), photoModelCover(photoIdeaModel(idea)));
  const videoManifest = JSON.parse(readFileSync(new URL('../video/model-preview-media.json', import.meta.url)));
  for (const [id, media] of Object.entries(videoManifest.models)) assert.equal(videoModelCover(id), media.thumb);
  for (const scenario of videoScenarios) {
    const cover = videoScenarioCover(scenario.id);
    assert.ok(cover.startsWith('https:'), `Missing cover for ${scenario.id}`);
    assert.ok(!cover.includes('.mp4'), `Cover must not load a video: ${scenario.id}`);
  }
  assert.equal(videoScenarioCover('genjutsu'), videoModelCover('higgsfield/genjutsu/motion-transfer/v1.0'));
  assert.equal(videoScenarioCover('ai-blogger'), photoModelCover('higgsfield/ai-influencer'));
  for (const cover of [photoModelCover('unknown'), videoModelCover('unknown'), videoScenarioCover('unknown')]) {
    assert.ok(cover.startsWith('data:image/svg+xml,'), 'Unknown models need a neutral placeholder');
  }
});

test('all 20 photo modes use the primary image from their own verified Playground', () => {
  const manifest = JSON.parse(readFileSync(new URL('./model-preview-media.json', import.meta.url)));
  assert.deepEqual(Object.keys(manifest.models).sort(), catalog.models.map(model => model.id).sort());
  for (const model of catalog.models) {
    const entry = manifest.models[model.id];
    assert.equal(entry.source, model.source);
    const url = new URL(entry.image);
    assert.equal(url.protocol, 'https:');
    assert.ok(
      (url.hostname === 'd28lhcrx5qdowv.cloudfront.net' && url.pathname.startsWith('/media/explore/media/'))
      || (url.hostname === 'static.higgsfield.ai' && url.pathname.startsWith('/api-workflows/')),
    );
    assert.deepEqual(photoModelPreview(model.id), { image: entry.image });
  }
  assert.equal(photoModelPreview('unknown'), null);
  assert.equal(photoModelPreview('constructor'), null);
  assert.equal(photoModelPreview('__proto__'), null);
});

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
