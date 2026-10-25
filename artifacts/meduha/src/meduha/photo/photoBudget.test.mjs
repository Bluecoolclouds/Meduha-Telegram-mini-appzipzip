import test from 'node:test';
import assert from 'node:assert/strict';
import { exceedsModelDailyBudget } from './photoBudget.ts';

test('warns only when a quoted photo package is above remaining model capacity', () => {
  assert.equal(exceedsModelDailyBudget(100, 100), false, 'an exact 100-credit fit is accepted');
  assert.equal(exceedsModelDailyBudget(110, 100), true, 'a 110-credit package exceeds a 100-credit daily remainder');
  assert.equal(exceedsModelDailyBudget(99, 100), false);
  assert.equal(exceedsModelDailyBudget(110, null), false, 'models without a daily cap have no remaining-capacity warning');
});
