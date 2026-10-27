CREATE TABLE IF NOT EXISTS meduha_bot_contacts (
 id text PRIMARY KEY, subscribed boolean NOT NULL DEFAULT false,
 reachable boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meduha_broadcast_media (
 id text PRIMARY KEY, kind text NOT NULL, content_type text NOT NULL,
 size integer NOT NULL, telegram_file_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meduha_broadcasts (
 id text PRIMARY KEY, actor_id text NOT NULL, title text NOT NULL, text text NOT NULL,
 media_id text, buttons jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'draft',
 tested_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meduha_broadcast_deliveries (
 id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES meduha_broadcasts(id),
 contact_id text NOT NULL REFERENCES meduha_bot_contacts(id), status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
 telegram_message_id text, error_code text,
 CONSTRAINT meduha_broadcast_deliveries_campaign_contact UNIQUE(campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS meduha_broadcast_pending_idx ON meduha_broadcast_deliveries(next_at) WHERE status='pending';
ALTER TABLE meduha_broadcast_media ADD COLUMN IF NOT EXISTS telegram_file_id text;
