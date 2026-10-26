import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Offline regression gate for reports/home-media-audit.md. These are byte
// budgets, not account/spending limits. Never import the app/server entrypoints.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const parse = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = parse('./Home.tsx');
const shared = parse('./shared/index.tsx');
const studio = parse('./studio.ts');
const manifest = parse('../../../api-server/src/lib/motion-example.ts');
const policy = parse('./templates/playback-policy.ts');
const feed = parse('./templates/TemplateFeed.tsx');

function nodes(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}
function named(root, name, predicate = ts.isVariableDeclaration) {
  const matches = nodes(root, node => predicate(node) && node.name?.getText(root) === name);
  assert.equal(matches.length, 1, `Expected one ${name} in ${root.fileName}`);
  return matches[0];
}
function expression(root, name) {
  return named(root, name).initializer.getText(root);
}
function compile(source, globals = {}) {
  const { outputText, diagnostics } = ts.transpileModule(`const subject = ${source};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    reportDiagnostics: true,
  });
  assert.equal(diagnostics.length, 0, 'Isolated media contract must compile');
  // Only checked-in expressions/functions run here; no imports, network, env,
  // credentials, storage clients, Telegram, or database are available.
  return runInNewContext(`${outputText}\nsubject;`, globals, { timeout: 1000 });
}
function component(root, name, globals) {
  return compile(named(root, name, ts.isFunctionDeclaration).getText(root).replace(/^export /, ''), globals);
}
function tags(root, name) {
  return nodes(root, node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    && node.tagName.getText(root) === name);
}
function attr(tag, name) {
  const value = tag.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.text === name);
  return value?.initializer;
}
function literalAttr(tag, name) {
  const value = attr(tag, name);
  assert.ok(value && ts.isStringLiteral(value), `Expected literal ${name} on ${tag.tagName.getText()}`);
  return value.text;
}
function budget(size, max, label) {
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= max,
    `${label}: ${size} bytes; allowed 1–${max} bytes (see reports/home-media-audit.md)`);
}
function webp(file, max) {
  const bytes = readFileSync(new URL(`../../public/images/brand/${file}`, import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${file}: expected WebP RIFF`);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${file}: expected WebP, not renamed PNG`);
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, `${file}: invalid RIFF length`);
  budget(bytes.length, max, file);
  return bytes.length;
}
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });

test('every Mood resolves to a real optimized WebP, including future Mood additions', () => {
  const type = named(studio, 'Mood', ts.isTypeAliasDeclaration).type;
  assert.ok(ts.isUnionTypeNode(type));
  const mood = compile(expression(studio, 'mood').replace('import.meta.env.BASE_URL', "'/'"));
  for (const member of type.types) {
    assert.ok(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal));
    const name = member.literal.text;
    assert.equal(mood(name), `/images/brand/mascot-${name}.webp`);
    // Glossy is a larger, high-resolution illustration, not a home mascot.
    const size = webp(`mascot-${name}.webp`, name === 'glossy' ? 180_000 : 16_000);
    const png = readFileSync(new URL(`../../public/images/brand/mascot-${name}.png`, import.meta.url));
    assert.ok(size < png.length / 4, `${name}: WebP must remain substantially smaller than the original`);
  }
});

test('home mascot group and logo retain small local byte budgets', () => {
  const total = ['hello', 'wink', 'joy', 'curious']
    .reduce((sum, name) => sum + webp(`mascot-${name}.webp`, 16_000), 0);
  budget(total, 50_000, 'four home mascots (audit baseline: 40,804)');
  webp('app-icon-ui.webp', 6_000);
  const brandAsset = compile(expression(shared, 'brandAsset').replace('import.meta.env.BASE_URL', "'/'"));
  assert.equal(brandAsset('app-icon'), '/images/brand/app-icon-ui.webp');
});

test('home keeps optimized asset bindings, lazy footer, and hero priority', () => {
  const mascots = tags(home, 'LiveMascot');
  assert.equal(mascots.length, 1);
  assert.ok(mascots[0].attributes.properties.some(p => p.name?.text === 'priority' && !p.initializer));
  assert.deepEqual(Array.from(compile(attr(mascots[0], 'moods').expression.getText(home))),
    ['hello', 'wink', 'joy']);
  const footer = tags(home, 'img').find(tag => attr(tag, 'src')?.getText(home).includes("mood('curious')"));
  assert.ok(footer, 'Keep the optimized curious footer mascot');
  assert.equal(literalAttr(footer, 'loading'), 'lazy');
  assert.equal(literalAttr(footer, 'decoding'), 'async');
  const logo = tags(home, 'img').find(tag => attr(tag, 'src')?.getText(home).includes("brandAsset('app-icon')"));
  assert.ok(logo, 'Home logo must use the optimized brand helper');
  assert.doesNotMatch(home.text, /\.png\b/i, 'Home must not reference original PNGs');
  assert.equal(nodes(home, node => ts.isCallExpression(node) && node.expression.getText(home) === 'asset').length, 0,
    'Do not use the original-PNG asset helper on Home');
});

test('LiveMascot gives only its first image high priority and decodes asynchronously', () => {
  const render = component(shared, 'LiveMascot', {
    React: { createElement }, useState: () => [0, () => {}], useEffect: () => {},
    mood: name => `/images/brand/mascot-${name}.webp`,
  });
  const images = render({ moods: ['hello', 'wink', 'joy'], priority: true }).children[0];
  assert.deepEqual(Array.from(images, image => image.props.fetchPriority), ['high', 'low', 'low']);
  for (const image of images) {
    assert.equal(image.props.decoding, 'async');
    assert.notEqual(image.props.loading, 'lazy', 'Hero must not defer its first image');
    assert.match(image.props.src, /\.webp$/);
  }
});

test('home storage manifest keeps photo/poster/video byte budgets and MIME types', () => {
  const assets = compile(expression(manifest, 'motionAssets'));
  const photos = compile(expression(home, 'homePhotoFiles'));
  assert.equal(photos.length, 4);
  const video = 'home-video.mp4';
  const poster = 'home-video-poster.webp';
  const names = [...photos, poster, video];
  assert.deepEqual(Object.keys(assets).filter(name => name.startsWith('home-')).sort(), [...names].sort());
  for (const name of names) {
    const asset = assets[name];
    assert.ok(asset, `Missing manifest entry: ${name}`);
    assert.ok(asset.id, `${name}: immutable object ID is required`);
    assert.equal(asset.contentType, name === video ? 'video/mp4' : 'image/webp');
    budget(asset.size, name === video ? 800_000 : name === poster ? 16_000 : 70_000, name);
  }
  budget(photos.reduce((sum, name) => sum + assets[name].size, 0), 180_000, 'four home photos');
  const videoTag = tags(home, 'video')[0];
  assert.equal(literalAttr(videoTag, 'poster'), `/api/meduha/example-media/${poster}`);
  const sourceAssignments = nodes(named(home, 'HomeVideoPreview', ts.isFunctionDeclaration),
    node => ts.isBinaryExpression(node) && node.left.getText(home) === 'video.src');
  assert.equal(sourceAssignments.length, 1);
  assert.equal(sourceAssignments[0].right.text, `/api/meduha/example-media/${video}`);
  assert.match(home.text, /homePhotoFiles\[index\]/, 'Photo card must use the budgeted list');
});

test('home video is source-free at render and loads only when visible, active and allowed', () => {
  for (const visible of [false, true]) for (const pageActive of [false, true]) for (const canAutoplay of [false, true]) {
    const effects = [];
    const calls = [];
    let observer;
    const video = {
      pause: () => calls.push('pause'), load: () => calls.push('load'),
      play: () => { calls.push('play'); return Promise.resolve(); },
      removeAttribute: name => { calls.push(`remove:${name}`); delete video[name]; },
      set src(value) { calls.push(`src:${value}`); },
    };
    const render = component(home, 'HomeVideoPreview', {
      React: { createElement }, useRef: () => ({ current: video }),
      useState: () => [visible, () => {}], useEffect: fn => effects.push(fn),
      usePlaybackPolicy: () => ({ pageActive, canAutoplay }),
      IntersectionObserver: class {
        constructor() { observer = this; }
        observe(target) { assert.equal(target, video); }
        disconnect() { calls.push('disconnect'); }
      },
    });
    const tag = render();
    assert.equal(tag.type, 'video');
    assert.equal(tag.props.preload, 'none');
    assert.equal(tag.props.src, undefined, 'No unconditional video source');
    assert.equal(tag.props.autoPlay, undefined, 'Playback must go through policy');
    assert.equal(tag.children.length, 0, 'No unconditional <source>');
    const cleanups = effects.map(fn => fn());
    assert.ok(observer, 'Visibility must be observed');
    const allowed = visible && pageActive && canAutoplay;
    assert.equal(calls.includes('play'), allowed, JSON.stringify({ visible, pageActive, canAutoplay }));
    assert.equal(calls.some(call => call.startsWith('src:')), allowed);
    if (!allowed) assert.ok(calls.includes('remove:src'), 'Blocked video releases its source');
    for (const cleanup of cleanups) cleanup?.();
    assert.ok(calls.includes('disconnect'));
    if (allowed) {
      assert.ok(calls.includes('pause'), 'Unmount pauses playback');
      assert.ok(calls.includes('remove:src'), 'Unmount releases its source');
    }
  }
});

test('home playback policy blocks hidden pages, reduced motion, Save-Data and 2G', () => {
  const playbackPolicy = component(policy, 'playbackPolicy');
  const normal = { pageActive: true, reducedMotion: false };
  assert.equal(playbackPolicy(normal).canAutoplay, true);
  for (const signal of [
    { pageActive: false }, { reducedMotion: true }, { saveData: true },
    { effectiveType: '2g' }, { effectiveType: 'slow-2g' },
  ]) assert.equal(playbackPolicy({ ...normal, ...signal }).canAutoplay, false, JSON.stringify(signal));
});

test('home feed tiles mount video only for visible, permitted previews, never originals', () => {
  for (const visible of [false, true]) for (const autoplay of [false, true]) {
    const states = [false, false, false, visible];
    const render = component(feed, 'MosaicTile', {
      React: { createElement }, useRef: () => ({ current: null }),
      useState: () => [states.shift(), () => {}], useEffect: () => {},
      feedMediaUrl: (id, kind) => `/feed/${id}/${kind}`, ratioOf: () => 1,
      Music2: 'music', Clapperboard: 'clapperboard', Camera: 'camera', Play: 'play',
    });
    const tile = render({
      template: { id: 'local-fixture', kind: 'video', videoUrl: '/original.mp4', title: 'Fixture' },
      autoplay, onOpen: () => {}, reportVisibility: () => {},
    });
    function elements(node) {
      if (!node || typeof node !== 'object') return [];
      return [node, ...(node.children ?? []).flatMap(elements)];
    }
    const videos = elements(tile).filter(node => node.type === 'video');
    assert.equal(videos.length, visible && autoplay ? 1 : 0);
    for (const video of videos) {
      assert.equal(video.props.preload, 'none');
      assert.equal(video.props.src, '/feed/local-fixture/preview');
      assert.equal(video.props.poster, '/feed/local-fixture/thumb');
      assert.equal(video.props.autoPlay, undefined);
    }
    const image = elements(tile).find(node => node.type === 'img');
    assert.equal(image.props.loading, 'lazy');
    assert.equal(image.props.decoding, 'async');
    assert.equal(image.props.src, '/feed/local-fixture/thumb');
  }
});
