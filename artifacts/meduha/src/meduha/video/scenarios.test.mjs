import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { searchVideoScenarios, scenarioProvider, videoScenarioProviders, videoScenarioProviderLabel, videoScenarios, scenarioDraftHref } from './scenarios.ts';
import { formatScenarioPrice, scenarioCreditPrice } from './prices.ts';
import { genjutsuPreviewScenario, isDirectVideoScenario, videoScenarioGenerationHref, videoScenarioModel, videoScenarioParameters, videoScenarioNotice } from './scenarioGeneration.ts';
import { videoModelPreview } from './modelPreviews.ts';

const catalogue = JSON.parse(readFileSync(new URL('../../../../api-server/src/lib/video-catalog.json', import.meta.url), 'utf8'));

test('catalog prices match exact upstream endpoints and use the lowest configured price', () => {
  const scenario = videoScenarios.find(s => s.id === 'text-to-video');
  const prices = [
    { upstreamId: `/${scenario.endpoint}`, creditPrice: 30 },
    { upstreamId: scenario.endpoint, creditPrice: 20 },
    { upstreamId: 'other/model', creditPrice: 1 },
    { upstreamId: scenario.endpoint, creditPrice: 0 },
  ];
  assert.equal(scenarioCreditPrice(scenario, prices), 20);
  assert.equal(formatScenarioPrice(20), 'от 20 кр.');
  assert.equal(scenarioCreditPrice(scenario, []), null);
  assert.equal(formatScenarioPrice(null), 'Цена уточняется');
});

test('composite scenarios never show a component price as their total', () => {
  const blogger = videoScenarios.find(s => s.id === 'ai-blogger');
  assert.equal(scenarioCreditPrice(blogger, [{ upstreamId: blogger.endpoint, creditPrice: 10 }]), null);
  const genjutsu = videoScenarios.find(s => s.id === 'genjutsu');
  assert.equal(scenarioCreditPrice(genjutsu, [{ upstreamId: genjutsu.endpoint, creditPrice: 10 }]), null,
    'a variable-duration and resolution-based tariff is not represented by the legacy fixed model price');
  for (const scenario of videoScenarios.filter(s => s.availability !== 'documented')) {
    assert.equal(scenarioCreditPrice(scenario, []), null);
  }
});

test('model provider filters come from upstream IDs and exclude non-model scenarios', () => {
  assert.deepEqual(videoScenarioProviders, ['bytedance', 'higgsfield']);
  assert.equal(videoScenarioProviderLabel('bytedance'), 'ByteDance');
  assert.equal(videoScenarioProviderLabel('higgsfield'), 'Модель Meduha');
  assert.deepEqual(videoScenarios.filter(s => scenarioProvider(s) === 'bytedance').map(s => s.id), ['text-to-video', 'image-to-video']);
  assert.ok(videoScenarios.filter(s => scenarioProvider(s) === 'higgsfield').length > 0);
  assert.equal(scenarioProvider(videoScenarios.find(s => s.id === 'katana')), null);
  assert.equal(scenarioProvider(videoScenarios.find(s => s.id === 'content-factory')), null);
});

test('natural-language searches rank the relevant scenarios', () => {
  for (const [query, expected] of [
    ['хочу оживить фото', 'image-to-video'],
    ['хочу чтобы персонаж повторял танец', 'genjutsu'],
    ['джиуджитсу', 'genjutsu'],
    ['katana', 'katana'],
    ['нужна реклама для бизнеса', 'content-factory'],
    ['заменить одежду', 'object-swap'],
    ['аниме', 'restyle'],
    ['ИИ блогер', 'ai-blogger'],
    ['cinema', 'cinema'],
  ]) assert.equal(searchVideoScenarios(query)[0]?.id, expected, query);
});
test('empty and generic queries show the catalog; unknown queries are empty', () => {
  assert.equal(searchVideoScenarios('').length, videoScenarios.length);
  assert.equal(searchVideoScenarios('хочу видео').length, videoScenarios.length);
  assert.deepEqual(searchVideoScenarios('qqqunknownxyz'), []);
});
test('availability distinguishes REST endpoints from workflows and MCP', () => {
  for (const scenario of videoScenarios) {
    assert.match(scenario.source, /^https:\/\//);
    assert.equal(Boolean(scenario.endpoint), scenario.availability === 'documented');
  }
  assert.equal(new Set(videoScenarios.map(s => s.id)).size, videoScenarios.length);
});
test('scenario navigation safely preserves brief and identifies selected scenario', () => {
  const scenario = videoScenarios[0];
  const url = new URL(scenarioDraftHref(scenario, 'Мой товар & блог #1'), 'https://example.com');
  assert.equal(url.pathname, '/create');
  assert.equal(url.searchParams.get('type'), 'video');
  assert.equal(url.searchParams.get('editor'), '1');
  assert.equal(url.searchParams.get('scenario'), scenario.id);
  assert.equal(url.searchParams.get('preset'), scenario.title);
  assert.match(url.searchParams.get('prompt'), /Мой товар & блог #1/);
});

test('direct video scenarios open actual documented generators, not draft-only workspaces', () => {
  for (const scenario of videoScenarios.filter(item => isDirectVideoScenario(item.id))) {
    const url = new URL(scenarioDraftHref(scenario, 'Мой ролик & сцена #1'), 'https://example.com');
    assert.equal(url.searchParams.get('editor'), null);
    assert.equal(url.searchParams.get('videoIdea'), scenario.id);
    assert.equal(url.searchParams.get('videoModel'), videoScenarioModel(scenario.id));
    assert.match(url.searchParams.get('ideaPrompt'), /Мой ролик & сцена #1/);
    assert.ok(catalogue.models.some(model => model.id === url.searchParams.get('videoModel')));
  }
});

test('scenario context survives all documented video modes without changing parameter schemas', () => {
  const scenario = videoScenarios.find(item => item.id === 'image-to-video');
  assert.equal(catalogue.models.length, 75);
  assert.equal(new Set(catalogue.families.flatMap(group => group.modes)).size, 75);
  assert.equal(catalogue.families.flatMap(group => group.modes).length, 75);
  for (const model of catalogue.models) {
    const context = { prompt: 'My custom motion & camera', ratio: '16:9', duration: '5 сек', draftId: 'draft-123' };
    const url = new URL(videoScenarioGenerationHref(scenario, context, model.id), 'https://example.com');
    assert.equal(url.searchParams.get('videoModel'), model.id);
    assert.equal(url.searchParams.get('videoIdea'), scenario.id);
    assert.equal(url.searchParams.get('ideaPrompt'), context.prompt);
    assert.equal(url.searchParams.get('videoDraft'), 'draft-123');
    const seed = videoScenarioParameters({ scenario, ...context }, model.schema);
    assert.equal(seed.parameters.prompt, context.prompt);
    for (const key of Object.keys(seed.parameters)) assert.ok(key in model.schema.properties);
  }
});

test('unsupported duration and ratio are reported, not silently rounded or forced into an API payload', () => {
  const scenario = videoScenarios.find(item => item.id === 'cinema');
  const model = catalogue.models.find(item => item.id === videoScenarioModel(scenario.id));
  const result = videoScenarioParameters({ scenario, prompt: scenario.prompt, duration: '99 сек', ratio: 'wrong' }, model.schema);
  assert.deepEqual(result.parameters, { prompt: scenario.prompt });
  assert.deepEqual(result.ignored, ['Формат кадра', 'Длительность']);
  const valid = videoScenarioParameters({ scenario, prompt: scenario.prompt, duration: '5 сек', ratio: '16:9' }, model.schema);
  assert.equal(valid.parameters.duration, 5);
  assert.equal(valid.parameters.aspect_ratio, '16:9');
});

test('composite scenarios label individual stages and do not pretend Katana has a public endpoint', () => {
  for (const id of ['katana', 'ai-blogger', 'content-factory']) {
    const scenario = videoScenarios.find(item => item.id === id);
    assert.equal(isDirectVideoScenario(id), false);
    assert.ok(catalogue.models.some(model => model.id === videoScenarioModel(id)));
    assert.equal(new URL(scenarioDraftHref(scenario), 'https://example.com').searchParams.get('scenario'), id);
    assert.match(videoScenarioNotice(id), /не|Не/);
  }
  assert.equal(videoScenarioModel('genjutsu'), null, 'the existing priced editor must not be replaced');
  assert.equal(videoScenarioModel('object-swap'), null);
  assert.equal(videoScenarioModel('restyle'), null);
});

test('all Seedance 2.5 modes expose the officially documented output format', () => {
  const modes = catalogue.models.filter(model => model.id.startsWith('bytedance/seedance-2.5/'));
  assert.equal(modes.length, 5);
  for (const model of modes) {
    assert.deepEqual(model.schema.properties.output_format.enum, ['mp4', 'mov']);
    assert.equal(model.schema.properties.output_format.default, 'mp4');
  }
});

test('every Genjutsu variant retains its original large video example', () => {
  const models = catalogue.models.filter(model => model.id.includes('genjutsu'));
  assert.equal(models.length, 7);
  for (const model of models) {
    const expected = model.id.includes('object-swap') ? 'object-swap' : model.id.includes('restyle') ? 'restyle' : 'genjutsu';
    assert.equal(genjutsuPreviewScenario(model.id), expected);
  }
  for (const model of catalogue.models.filter(model => !model.id.includes('genjutsu'))) assert.equal(genjutsuPreviewScenario(model.id), null);
});

test('every video mode uses verified media from its own Playground page', () => {
  const manifest = JSON.parse(readFileSync(new URL('./model-preview-media.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.models).sort(), catalogue.models.map(model => model.id).sort());
  for (const model of catalogue.models) {
    const entry = manifest.models[model.id];
    assert.equal(entry.source, model.source);
    assert.match(entry.video, /^https:\/\/d28lhcrx5qdowv\.cloudfront\.net\/media\/explore\/media\/[a-f0-9]{64}-video\.mp4$/);
    assert.match(entry.thumb, /^https:\/\/d28lhcrx5qdowv\.cloudfront\.net\/media\/explore\/media\/[a-f0-9]{64}-thumbnail\.webp$/);
    assert.deepEqual(videoModelPreview(model.id), { video: entry.video, thumb: entry.thumb });
  }
  assert.equal(videoModelPreview('not-a-model'), null);
  assert.equal(videoModelPreview('constructor'), null);
  assert.equal(videoModelPreview('__proto__'), null);
});
