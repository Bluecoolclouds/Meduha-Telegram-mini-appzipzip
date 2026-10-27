import test from 'node:test';
import assert from 'node:assert/strict';
import { applyContent, contentCover, coverProblem, isContentEnabled, mergeContent, photoExampleKey, photoIdeaKey, resolveContentUrl, toContentMap, videoScenarioKey } from './studioContent.ts';
import { photoIdeaModel, photoIdeas, searchPhotoIdeas } from './photo/ideas.ts';
import { searchVideoScenarios, videoScenarios } from './video/scenarios.ts';

const row = (key, extra = {}) => ({ key, title: '', description: '', cover: null, enabled: true, revision: 1, updatedAt: '2025-01-01T00:00:00Z', ...extra });

test('keys keep model ids with slashes', () => {
  assert.equal(photoExampleKey('higgsfield-ai/soul/v2/standard'), 'photo-example:higgsfield-ai/soul/v2/standard');
  assert.equal(videoScenarioKey('katana'), 'video-scenario:katana');
});

test('no overrides returns defaults unchanged', () => {
  const merged = mergeContent(photoIdeas, toContentMap([]), photoIdeaKey);
  assert.deepEqual(merged, photoIdeas);
  assert.equal(merged[0], photoIdeas[0]);
});

test('disabled items are removed, others keep order', () => {
  const map = toContentMap([row(photoIdeaKey('golden-hour'), { enabled: false })]);
  const merged = mergeContent(photoIdeas, map, photoIdeaKey);
  assert.equal(merged.length, photoIdeas.length - 1);
  assert.ok(!merged.some(i => i.id === 'golden-hour'));
  assert.equal(isContentEnabled(map, photoIdeaKey('golden-hour')), false);
  assert.equal(isContentEnabled(map, photoIdeaKey('unknown')), true);
});

test('title override applies, empty title falls back, empty description clears', () => {
  const base = photoIdeas[0];
  const a = applyContent(base, toContentMap([row(photoIdeaKey(base.id), { title: 'Новый', description: '' })]), photoIdeaKey);
  assert.equal(a.title, 'Новый');
  assert.equal(a.subtitle, '');
  const b = applyContent(base, toContentMap([row(photoIdeaKey(base.id), { description: 'Другое' })]), photoIdeaKey);
  assert.equal(b.title, base.title);
  assert.equal(b.subtitle, 'Другое');
});

test('prompt, keywords, category and model contract are preserved', () => {
  const base = photoIdeas.find(i => i.id === 'perfume-campaign');
  const merged = applyContent(base, toContentMap([row(photoIdeaKey(base.id), { title: 'X', description: 'Y' })]), photoIdeaKey);
  assert.equal(merged.prompt, base.prompt);
  assert.deepEqual(merged.keywords, base.keywords);
  assert.equal(photoIdeaModel(merged), photoIdeaModel(base));
  const s = videoScenarios[0];
  const vs = applyContent(s, toContentMap([row(videoScenarioKey(s.id), { title: 'Z' })]), videoScenarioKey);
  assert.equal(vs.prompt, s.prompt); assert.equal(vs.endpoint, s.endpoint); assert.equal(vs.providerLabel, s.providerLabel);
});

test('search uses edited titles and skips disabled items', () => {
  const map = toContentMap([row(photoIdeaKey('wave-poster'), { title: 'Бирюзовый прибой' }), row(photoIdeaKey('perfume-campaign'), { enabled: false })]);
  const ideas = mergeContent(photoIdeas, map, photoIdeaKey);
  assert.equal(searchPhotoIdeas('бирюзовый', ideas)[0]?.id, 'wave-poster');
  assert.ok(!searchPhotoIdeas('парфюм', ideas).some(i => i.id === 'perfume-campaign'));
  assert.equal(searchPhotoIdeas('парфюм')[0]?.id, 'perfume-campaign');
  const vmap = toContentMap([row(videoScenarioKey('katana'), { enabled: false })]);
  const scen = mergeContent(videoScenarios, vmap, videoScenarioKey);
  assert.ok(!searchVideoScenarios('катана', scen).some(s => s.id === 'katana'));
  assert.equal(searchVideoScenarios('', scen).length, videoScenarios.length - 1);
});

test('cover falls back only when null or blank', () => {
  const map = toContentMap([row('a', { cover: '/api/meduha/studio-content-media/0b6f1c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' }), row('b', { cover: null }), row('c', { cover: '  ' })]);
  assert.equal(resolveContentUrl(contentCover(map, 'a'), '/app/'), '/app/api/meduha/studio-content-media/0b6f1c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e');
  assert.equal(contentCover(map, 'b'), null);
  assert.equal(contentCover(map, 'c'), null);
  assert.equal(contentCover(map, 'missing'), null);
  assert.equal(resolveContentUrl('https://cdn.example.com/x.webp', '/'), 'https://cdn.example.com/x.webp');
});

test('cover validation mirrors server policy', () => {
  for (const ok of ['', 'https://cdn.example.com/a.webp', '/images/x.png', '/api/meduha/example-media/a/b.webp', '/api/meduha/studio-content-media/0b6f1c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e']) assert.equal(coverProblem(ok), null, ok);
  for (const bad of ['http://cdn.example.com/a.png', 'https://user:pw@cdn.example.com/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'data:image/png;base64,AAA', '/api/meduha/admin/x', '/images/../secret', 'javascript:alert(1)']) assert.notEqual(coverProblem(bad), null, bad);
});
