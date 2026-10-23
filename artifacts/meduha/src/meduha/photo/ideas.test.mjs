import test from 'node:test';
import assert from 'node:assert/strict';
import { photoIdeaHref, photoIdeas, searchPhotoIdeas } from './ideas.ts';

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

test('idea route passes the exact local prompt to the photo editor', () => {
  const idea = photoIdeas[0];
  const url = new URL(photoIdeaHref(idea), 'https://meduha.local');
  assert.equal(url.pathname, '/create');
  assert.equal(url.searchParams.get('type'), 'photo');
  assert.equal(url.searchParams.get('editor'), '1');
  assert.equal(url.searchParams.get('prompt'), idea.prompt);
});
