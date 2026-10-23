import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LONG_HELD_SEEDANCE_THRESHOLD_SECONDS,
  formatSeedanceReservationAge,
  isLongHeldSeedanceReservation,
} from './seedanceAge.ts';

test('flags only held reservations older than the documented threshold', () => {
  assert.equal(isLongHeldSeedanceReservation('held', LONG_HELD_SEEDANCE_THRESHOLD_SECONDS), false);
  assert.equal(isLongHeldSeedanceReservation('held', LONG_HELD_SEEDANCE_THRESHOLD_SECONDS + 1), true);
  assert.equal(isLongHeldSeedanceReservation('settled', LONG_HELD_SEEDANCE_THRESHOLD_SECONDS + 1), false);
  assert.equal(isLongHeldSeedanceReservation('held', null), false);
});

test('formats reservation ages in readable units', () => {
  assert.equal(formatSeedanceReservationAge(30), 'меньше минуты');
  assert.equal(formatSeedanceReservationAge(15 * 60), '15 мин');
  assert.equal(formatSeedanceReservationAge(90 * 60), '1 ч 30 мин');
  assert.equal(formatSeedanceReservationAge(27 * 60 * 60), '1 д 3 ч');
});
