-- Development-only, owner-approved configuration. No provider calls or wallet writes.
-- Run after catalog registration. Never run from application startup or deployment.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(1967011431);
LOCK TABLE meduha_finance_settings, meduha_ai_channels, meduha_ai_models,
  meduha_admin_audit IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE meduha_generation_jobs, meduha_credit_reservations,
  meduha_finance_ledger IN SHARE MODE;

DO $approved$
DECLARE
  v_channel_id text;
  affected integer;
  prices jsonb := '{
    "higgsfield-ai/soul/standard": 15,
    "higgsfield-ai/soul/v2/standard": 1,
    "higgsfield-ai/soul/v2/image-to-image": 1,
    "xai/grok-imagine-image-2.0": 7,
    "marketing-studio/image": 55,
    "higgsfield/ai-influencer": 4,
    "ideogram/v4.0": 3,
    "recraft/v4.1/text-to-image": 3,
    "alibaba/qwen-image-3/text-to-image": 6,
    "z-image/turbo": 2,
    "marketing-studio/image/flare": 55,
    "marketing-studio/image/sunburst": 55,
    "recraft/v4.1/pro/text-to-image": 16,
    "recraft/v4.1/utility/text-to-image": 3,
    "recraft/v4.1/utility/pro/text-to-image": 16,
    "alibaba/qwen-image-3/edit": 6
  }';
BEGIN
  -- Once applied, do not overwrite later administrator decisions on subsequent merges.
  IF EXISTS (SELECT 1 FROM meduha_admin_audit
    WHERE action = 'photo.pricing.approved.apply'
      AND entity_id = 'photo-pilot-2026-10-25') THEN
    RAISE NOTICE 'Approved photo pricing already applied; no settings changed.';
    RETURN;
  END IF;

  -- A clean import has the table but not necessarily the finance singleton yet.
  -- Approval of the existing pilot is not permission to seed a fresh wallet policy.
  IF NOT EXISTS (SELECT 1 FROM meduha_finance_settings WHERE id = 1) THEN
    RAISE NOTICE 'Finance settings not seeded; skipping approved pilot configuration.';
    RETURN;
  END IF;

  IF (SELECT count(*) FROM meduha_ai_channels WHERE adapter = 'higgsfield') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Higgsfield channel; no changes applied';
  END IF;
  SELECT id INTO STRICT v_channel_id FROM meduha_ai_channels WHERE adapter = 'higgsfield';

  -- Reject drift, rather than silently replacing any independently configured policy.
  IF NOT EXISTS (SELECT 1 FROM meduha_finance_settings
      WHERE id = 1 AND NOT spending_enabled AND daily_credit_limit = 0
        AND max_active_reservations = 3)
    OR EXISTS (SELECT 1 FROM meduha_ai_channels
      WHERE id = v_channel_id AND (enabled OR daily_credit_limit <> 0 OR concurrency_limit <> 1))
    OR EXISTS (SELECT 1 FROM meduha_ai_models
      WHERE kind = 'photo' AND enabled)
    OR EXISTS (SELECT 1 FROM meduha_ai_models m
      WHERE m.channel_id = v_channel_id AND m.kind = 'photo' AND prices ? m.upstream_id
        AND (m.credit_price <> 0 OR m.limits <> '{}'::jsonb)) THEN
    RAISE EXCEPTION 'Configuration differs from the approved disabled baseline; no changes applied';
  END IF;

  IF EXISTS (SELECT 1 FROM meduha_generation_jobs)
    OR EXISTS (SELECT 1 FROM meduha_credit_reservations)
    OR EXISTS (SELECT 1 FROM meduha_finance_ledger) THEN
    RAISE EXCEPTION 'Expected unused pilot database; no changes applied';
  END IF;

  UPDATE meduha_ai_models m SET
    credit_price = (prices ->> m.upstream_id)::integer,
    limits = jsonb_build_object('dailyCreditLimit', 100),
    updated_at = now()
  WHERE m.channel_id = v_channel_id AND m.kind = 'photo' AND prices ? m.upstream_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 16 OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(prices) p(upstream_id)
    WHERE (SELECT count(*) FROM meduha_ai_models m
      WHERE m.channel_id = v_channel_id AND m.kind = 'photo' AND m.upstream_id = p.upstream_id) <> 1
  ) THEN
    RAISE EXCEPTION 'Expected all 16 approved endpoints exactly once; transaction rolled back';
  END IF;

  UPDATE meduha_ai_channels SET daily_credit_limit = 500, updated_at = now()
    WHERE id = v_channel_id;
  UPDATE meduha_finance_settings SET daily_credit_limit = 500,
    updated_at = now(), updated_by = 'owner-approved-configuration'
    WHERE id = 1;
  -- No assignments to enabled/spending_enabled, no unapproved prices or account limits.
  -- Ads Studio, SOUL Cinema, video/audio models and wallet tables are untouched.
  INSERT INTO meduha_admin_audit (actor_id, action, entity_type, entity_id, details)
  VALUES ('owner-approved-configuration', 'photo.pricing.approved.apply',
    'configuration', 'photo-pilot-2026-10-25',
    '{"approvedPhotoEndpoints":16,"globalDailyCreditLimit":500,"channelDailyCreditLimit":500,"modelDailyCreditLimit":100,"concurrencyLimit":1,"maxActiveReservations":3,"spendingEnabled":false}'::jsonb);
END
$approved$;
COMMIT;
