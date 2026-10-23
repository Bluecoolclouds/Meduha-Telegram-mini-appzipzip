import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMediaSignature } from './template-files';

test('uploaded template media must match its declared image/video file signature', () => {
  assert.equal(hasMediaSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true);
  assert.equal(hasMediaSignature(Buffer.from([255, 216, 255]), 'image/jpeg'), true);
  assert.equal(hasMediaSignature(Buffer.from('RIFF0000WEBP'), 'image/webp'), true);
  assert.equal(hasMediaSignature(Buffer.from('0000ftypisom'), 'video/mp4'), true);
  assert.equal(hasMediaSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm'), true);
});

test('uploaded template media rejects dangerous, unsupported, and mismatched formats', () => {
  assert.equal(hasMediaSignature(Buffer.from('<svg/>'), 'image/png'), false);
  assert.equal(hasMediaSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'video/mp4'), false);
  assert.equal(hasMediaSignature(Buffer.from('<svg/>'), 'image/svg+xml'), false);
  assert.equal(hasMediaSignature(Buffer.from('<!doctype html><script>alert(1)</script>'), 'image/jpeg'), false);
  assert.equal(hasMediaSignature(Buffer.from('MZ'), 'image/png'), false);
  assert.equal(hasMediaSignature(Buffer.from('GIF89a'), 'image/gif'), false);
  assert.equal(hasMediaSignature(Buffer.alloc(0), 'image/png'), false);
});

test('audio signatures accept MP3/WAV and reject mismatched or truncated files', () => {
  assert.equal(hasMediaSignature(Buffer.from('RIFF0000WAVEfmt '), 'audio/wav'), true);
  assert.equal(hasMediaSignature(Buffer.from('RIFF0000WAVEfmt '), 'audio/x-wav'), true);
  assert.equal(hasMediaSignature(Buffer.from([0xff, 0xfb, 0x90, 0]), 'audio/mpeg'), true);
  assert.equal(hasMediaSignature(Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'), true);
  for (const bytes of [Buffer.alloc(0), Buffer.from('ID3'), Buffer.from('<html>'), Buffer.from('RIFF0000WEBP'), Buffer.from([0xff, 0xf1, 0x90, 0])]) {
    assert.equal(hasMediaSignature(bytes, 'audio/mpeg'), false);
    assert.equal(hasMediaSignature(bytes, 'audio/wav'), false);
  }
});
