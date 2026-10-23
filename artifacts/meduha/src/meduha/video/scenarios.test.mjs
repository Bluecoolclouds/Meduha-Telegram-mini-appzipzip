import assert from 'node:assert/strict';
import test from 'node:test';
import { searchVideoScenarios, scenarioProvider, videoScenarioProviders, videoScenarioProviderLabel, videoScenarios, scenarioDraftHref } from './scenarios.ts';
import { formatScenarioPrice, scenarioCreditPrice } from './prices.ts';

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
  assert.equal(videoScenarioProviderLabel('higgsfield'), 'Higgsfield');
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
