import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sql = readFileSync(new URL('./apply-approved-photo-pricing.sql', import.meta.url), 'utf8');
// Session-local tables shadow public tables. No public configuration/wallet writes,
// no real audit sequence increments and no provider/API calls.
const fixture = `
  CREATE TEMP TABLE meduha_finance_settings (LIKE public.meduha_finance_settings);
  INSERT INTO meduha_finance_settings SELECT * FROM public.meduha_finance_settings;
  UPDATE meduha_finance_settings SET spending_enabled=false, daily_credit_limit=0, max_active_reservations=3;
  CREATE TEMP TABLE meduha_ai_channels (LIKE public.meduha_ai_channels);
  INSERT INTO meduha_ai_channels SELECT * FROM public.meduha_ai_channels;
  UPDATE meduha_ai_channels SET enabled=false, daily_credit_limit=0, concurrency_limit=1;
  CREATE TEMP TABLE meduha_ai_models (LIKE public.meduha_ai_models);
  INSERT INTO meduha_ai_models SELECT * FROM public.meduha_ai_models;
  UPDATE meduha_ai_models SET enabled=false, credit_price=0, limits='{}';
  CREATE TEMP TABLE meduha_generation_jobs (LIKE public.meduha_generation_jobs);
  CREATE TEMP TABLE meduha_credit_reservations (LIKE public.meduha_credit_reservations);
  CREATE TEMP TABLE meduha_finance_ledger (LIKE public.meduha_finance_ledger);
  CREATE TEMP TABLE meduha_admin_audit (
    id serial, actor_id text, action text, entity_type text, entity_id text, details jsonb
  );
`;
function run(input) {
  return spawnSync('bash', ['-c', 'exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --quiet'], {
    input: fixture + input, encoding: 'utf8', timeout: 30_000,
  });
}
function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

test('approved settings apply without enabling, billing or touching excluded models', () => {
  succeeds(run(sql + `
    DO $check$ BEGIN
      IF (SELECT count(*) FROM meduha_ai_models WHERE credit_price > 0) <> 16
        OR (SELECT count(*) FROM meduha_ai_models WHERE limits = '{"dailyCreditLimit":100}') <> 16
        OR EXISTS (SELECT 1 FROM meduha_ai_models WHERE enabled)
        OR EXISTS (SELECT 1 FROM meduha_ai_channels WHERE enabled)
        OR NOT EXISTS (SELECT 1 FROM meduha_finance_settings WHERE NOT spending_enabled
          AND daily_credit_limit=500 AND max_active_reservations=3)
        OR NOT EXISTS (SELECT 1 FROM meduha_ai_channels WHERE adapter='higgsfield'
          AND daily_credit_limit=500 AND concurrency_limit=1)
        OR EXISTS (SELECT 1 FROM meduha_ai_models
          WHERE upstream_id IN ('higgsfield/ads-studio/v1.0','higgsfield-ai/soul/cinema')
            AND (credit_price<>0 OR limits<>'{}'::jsonb))
        OR EXISTS (SELECT 1 FROM meduha_ai_models WHERE kind<>'photo'
          AND (credit_price<>0 OR limits<>'{}'::jsonb))
        OR EXISTS (SELECT 1 FROM meduha_generation_jobs)
        OR EXISTS (SELECT 1 FROM meduha_credit_reservations)
        OR EXISTS (SELECT 1 FROM meduha_finance_ledger)
      THEN RAISE EXCEPTION 'Approved settings safety assertion failed'; END IF;
    END $check$;
  `));
});

test('repeat application preserves subsequent administrator decisions', () => {
  succeeds(run(sql + `
    UPDATE meduha_finance_settings SET daily_credit_limit=123;
    UPDATE meduha_ai_models SET credit_price=99 WHERE upstream_id='higgsfield-ai/soul/standard';
  ` + sql + `
    DO $check$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM meduha_finance_settings WHERE daily_credit_limit=123)
        OR NOT EXISTS (SELECT 1 FROM meduha_ai_models
          WHERE upstream_id='higgsfield-ai/soul/standard' AND credit_price=99)
        OR (SELECT count(*) FROM meduha_admin_audit) <> 1
      THEN RAISE EXCEPTION 'One-shot guard failed'; END IF;
    END $check$;
  `));
});

test('clean database setup succeeds without seeding finance settings or applying prices', () => {
  const result = run('DELETE FROM meduha_finance_settings;' + sql + `
    DO $check$ BEGIN
      IF EXISTS (SELECT 1 FROM meduha_finance_settings)
        OR EXISTS (SELECT 1 FROM meduha_ai_models WHERE credit_price<>0 OR limits<>'{}'::jsonb OR enabled)
        OR EXISTS (SELECT 1 FROM meduha_ai_channels WHERE daily_credit_limit<>0 OR enabled)
        OR EXISTS (SELECT 1 FROM meduha_admin_audit)
      THEN RAISE EXCEPTION 'Unseeded database was changed'; END IF;
    END $check$;
  `);
  succeeds(result);
  assert.match(result.stderr, /Finance settings not seeded; skipping/);
});

for (const [name, mutation, message] of [
  ['enabled spending', 'UPDATE meduha_finance_settings SET spending_enabled=true;', /disabled baseline/],
  ['changed model price', "UPDATE meduha_ai_models SET credit_price=9 WHERE upstream_id='higgsfield-ai/soul/standard';", /disabled baseline/],
  ['missing endpoint', "DELETE FROM meduha_ai_models WHERE upstream_id='higgsfield-ai/soul/standard';", /16 approved endpoints/],
  ['duplicate endpoint', `INSERT INTO meduha_ai_models
      SELECT * FROM meduha_ai_models WHERE upstream_id='higgsfield-ai/soul/standard';`, /16 approved endpoints/],
]) {
  test(`refuses ${name} rather than guessing or overwriting settings`, () => {
    const result = run(mutation + sql);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}
