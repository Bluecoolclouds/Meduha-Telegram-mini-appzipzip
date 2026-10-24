import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encoderArgs, variantKey } from './feed-media';

test('feed keys are deterministic, variant-specific, and contain no original URL or credentials', () => {
  const source = { key: 'https://media.example.com/video.mp4?token=private' };
  assert.equal(variantKey(source, 'thumb'), variantKey(source, 'thumb'));
  assert.notEqual(variantKey(source, 'thumb'), variantKey(source, 'preview'));
  assert.notEqual(variantKey(source, 'preview'), variantKey({ ...source, start: 5 }, 'preview'));
  assert.match(variantKey(source, 'thumb'), /^[a-f0-9]{64}$/);
});

test('preview encoding is capped at six seconds, silent, small, and fast-start', () => {
  const args = encoderArgs('source', 'preview.mp4', 'preview');
  for (const option of ['-an', '-sn', '-dn', '+faststart', '6', '300k', 'yuv420p']) assert.ok(args.includes(option));
  assert.ok(args.some(value => value.includes('fps=12')));
  assert.ok(args.some(value => value.includes('min(480')));
  assert.ok(encoderArgs('source', 'thumb.webp', 'thumb').includes('libwebp'));
});

test('real encoder creates a small WebP and a silent six-second MP4 without changing the source', async () => {
  const run = promisify(execFile);
  const dir = await mkdtemp(path.join(tmpdir(), 'meduha-preview-test-'));
  try {
    const input = path.join(dir, 'original.mp4');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '8', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', input], { timeout: 30_000 });
    const before = await stat(input);
    for (const variant of ['thumb', 'preview'] as const) {
      const out = path.join(dir, variant === 'thumb' ? 'thumb.webp' : 'preview.mp4');
      await run('ffmpeg', encoderArgs(input, out, variant), { timeout: 30_000 });
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]);
      const data = JSON.parse(stdout);
      assert.equal(data.streams.length, 1);
      assert.ok(data.streams[0].width <= 480 && data.streams[0].height <= 480);
      assert.ok(Number(data.format.size) < 1024 * 1024);
      if (variant === 'preview') {
        assert.equal(data.streams[0].codec_name, 'h264');
        assert.ok(Number(data.format.duration) <= 6.1);
      } else assert.equal(data.streams[0].codec_name, 'webp');
    }
    const after = await stat(input);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
