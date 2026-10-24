import assert from 'node:assert/strict';
import test from 'node:test';
import {
  missingRequiredScenarioMedia,
  scenarioInputSpecs,
  scenarioMediaError,
  scenarioReferenceMetadata,
} from './scenarioMedia.ts';

const image = (name = 'photo.jpg', size = 1, type = 'image/jpeg') => ({ name, size, type });
const video = (name = 'clip.mp4', size = 1, type = 'video/mp4') => ({ name, size, type });

test('required video and photo inputs determine when required media is missing', () => {
  const katana = scenarioInputSpecs.katana;
  assert.equal(missingRequiredScenarioMedia(katana, []), true);
  assert.equal(missingRequiredScenarioMedia(katana, [image()]), true);
  assert.equal(missingRequiredScenarioMedia(katana, [video()]), false);

  const imageToVideo = scenarioInputSpecs['image-to-video'];
  assert.equal(missingRequiredScenarioMedia(imageToVideo, []), true);
  assert.equal(missingRequiredScenarioMedia(imageToVideo, [image()]), false);
  assert.equal(missingRequiredScenarioMedia(imageToVideo, [video()]), true);
});

test('optional references may be omitted, and each scenario keeps its own file limits', () => {
  const blogger = scenarioInputSpecs['ai-blogger'];
  const cinema = scenarioInputSpecs.cinema;
  const katana = scenarioInputSpecs.katana;
  const imageToVideo = scenarioInputSpecs['image-to-video'];

  assert.equal(missingRequiredScenarioMedia(blogger, []), false);
  assert.equal(missingRequiredScenarioMedia(cinema, []), false);
  assert.equal(scenarioMediaError(blogger, []), null);
  assert.equal(scenarioMediaError(cinema, []), null);

  assert.equal(scenarioMediaError(katana, [video(), ...Array.from({ length: 5 }, (_, i) => image(`p${i}.jpg`))]), null);
  assert.equal(scenarioMediaError(katana, [video(), ...Array.from({ length: 6 }, (_, i) => image(`p${i}.jpg`))]), 'Можно добавить одно видео и до 5 фото');
  assert.equal(scenarioMediaError(katana, [video(), video('second.webm', 1, 'video/webm')]), 'Можно добавить одно видео и до 5 фото');
  assert.equal(scenarioMediaError(blogger, [image(), image('second.jpg')]), 'Можно добавить до 1 фото');
  assert.equal(scenarioMediaError(cinema, Array.from({ length: 5 }, (_, i) => image(`p${i}.jpg`))), null);
  assert.equal(scenarioMediaError(cinema, Array.from({ length: 6 }, (_, i) => image(`p${i}.jpg`))), 'Можно добавить до 5 фото');
  assert.equal(scenarioMediaError(imageToVideo, [image(), image('second.jpg')]), 'Можно добавить до 1 фото');
});

test('rejects unsupported media types and files above their size limits', () => {
  const katana = scenarioInputSpecs.katana;
  const imageToVideo = scenarioInputSpecs['image-to-video'];

  assert.equal(scenarioMediaError(katana, [{ name: 'notes.pdf', type: 'application/pdf', size: 10 }]), 'Выбери изображение до 10 МиБ');
  assert.equal(scenarioMediaError(katana, [video('clip.mov', 10, 'video/quicktime')]), 'Выбери видео MP4 или WebM');
  assert.equal(scenarioMediaError(imageToVideo, [video()]), 'Выбери видео MP4 или WebM');
  assert.equal(scenarioMediaError(imageToVideo, [image('large.jpg', 10 * 1024 * 1024 + 1)]), 'Выбери изображение до 10 МиБ');
  assert.equal(scenarioMediaError(katana, [video('large.mp4', 200 * 1024 * 1024 + 1)]), 'Видео — до 200 МиБ');

  assert.equal(scenarioMediaError(imageToVideo, [image('max.jpg', 10 * 1024 * 1024)]), null);
  assert.equal(scenarioMediaError(katana, [video('max.mp4', 200 * 1024 * 1024)]), null);
});

test('persisted scenario metadata contains filenames only; file objects stay outside the draft data', () => {
  const selected = [
    { ...image('face.jpg'), contents: new Uint8Array([1, 2, 3]) },
    { ...video('scene.webm', 1, 'video/webm'), contents: new Uint8Array([4, 5, 6]) },
  ];
  const before = [...selected];
  const metadata = scenarioReferenceMetadata(selected);

  assert.deepEqual(metadata, { referenceName: 'face.jpg, scene.webm' });
  assert.deepEqual(selected, before);
  assert.equal(Object.hasOwn(metadata, 'files'), false);
  assert.equal(Object.hasOwn(metadata, 'contents'), false);
  assert.equal(Object.hasOwn(metadata, 'referenceName') && 'contents' in metadata, false);
});
