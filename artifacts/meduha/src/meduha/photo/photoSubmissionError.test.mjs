import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPhotoDailyLimitError } from './photoSubmissionError.ts';

test('recognizes daily limit rejections by their structured server code', () => {
  for (const error of [
    'Daily credit limit would be exceeded',
    'Channel daily credit limit would be exceeded',
    'Model daily credit limit would be exceeded',
    'Дневной лимит кредитов аккаунта исчерпан.',
  ]) {
    assert.equal(isPhotoDailyLimitError({ status: 409, data: { code: 'DAILY_LIMIT_EXCEEDED', error } }), true);
  }
});

test('does not mislabel other refusals, network failures or unstructured text as a daily limit', () => {
  for (const code of [
    'INSUFFICIENT_CREDITS', 'ACTIVE_RESERVATION_LIMIT', 'SPENDING_DISABLED',
    'STALE_PRICE_QUOTE', 'UNSAFE_PHOTO_PRICE', 'PRICE_CHANGED',
    'IDEMPOTENCY_CONFLICT', 'PHOTO_TEMPORARILY_UNAVAILABLE',
  ]) {
    assert.equal(isPhotoDailyLimitError({ status: 409, data: { code, error: 'Daily limit' } }), false, code);
  }
  for (const error of [null, undefined, {}, { data: null }, { data: { error: 'DAILY_LIMIT_EXCEEDED' } }, new Error('DAILY_LIMIT_EXCEEDED')]) {
    assert.equal(isPhotoDailyLimitError(error), false);
  }
});

test('photo form clears the refused quote, shows recovery guidance and disables automatic mutation retries', () => {
  const source = readFileSync(new URL('./PhotoStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /useCreatePhotoGeneration\(\{ mutation: \{ retry: false \}/);
  assert.match(source, /if \(isPhotoDailyLimitError\(e\)\)[\s\S]*?setQuote\(null\);[\s\S]*?setDailyLimitFailureFp\(fp\);[\s\S]*?return;/);
  assert.match(source, /dailyLimitFailureFp === fp && <div[^>]*role="alert"[^>]*data-testid="status-photo-daily-limit"/);
  assert.match(source, /<strong>Дневного лимита не хватает<\/strong>\{PHOTO_DAILY_LIMIT_MESSAGE\}/);
});
