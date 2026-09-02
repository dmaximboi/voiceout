-- Studio billing + follow notify preference + admin device binding
ALTER TABLE users ADD COLUMN IF NOT EXISTS studio_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_device_hash varchar(64);

ALTER TABLE follows ADD COLUMN IF NOT EXISTS notify_posts boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS billing_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL DEFAULT 'bachs',
  checkout_id varchar(128) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open',
  purpose varchar(32) NOT NULL DEFAULT 'studio',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkouts_checkout_id_idx ON billing_checkouts (checkout_id);
CREATE INDEX IF NOT EXISTS billing_checkouts_user_idx ON billing_checkouts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id varchar(128) PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
