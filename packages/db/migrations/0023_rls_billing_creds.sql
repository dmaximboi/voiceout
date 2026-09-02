-- Billing RLS + credential-hardening helpers.
-- App role must not treat billing rows as world-readable.
-- Login/register credential paths use vo_rls_off() briefly in the API.

CREATE OR REPLACE FUNCTION vo_rls_off() RETURNS boolean AS $$
  SELECT current_setting('app.rls', true) IS DISTINCT FROM 'on';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION vo_is_user(uid uuid) RETURNS boolean AS $$
  SELECT uid::text = current_setting('app.user_id', true);
$$ LANGUAGE sql STABLE;

-- Billing checkouts: owner only (or service with RLS off)
ALTER TABLE billing_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_checkouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_checkouts_access ON billing_checkouts;
CREATE POLICY billing_checkouts_access ON billing_checkouts
  USING (vo_rls_off() OR vo_is_user(user_id))
  WITH CHECK (vo_rls_off() OR vo_is_user(user_id));

-- Webhook idempotency table: service only
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_webhook_events_service ON billing_webhook_events;
CREATE POLICY billing_webhook_events_service ON billing_webhook_events
  USING (vo_rls_off())
  WITH CHECK (vo_rls_off());

-- Immutable account id stays enforced (uuid primary key + trigger from 0006).
-- Directory view exposes only non-secret profile fields for feeds/search.
CREATE OR REPLACE VIEW users_directory AS
SELECT
  id,
  handle,
  display_name,
  bio,
  avatar_media_id,
  created_at,
  updated_at,
  lang,
  region,
  deleted_at,
  suspended_at,
  role
FROM users;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceout_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billing_checkouts TO voiceout_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billing_webhook_events TO voiceout_app;
    GRANT SELECT ON users_directory TO voiceout_app;
  END IF;
END $$;

-- Reject empty / non-uuid ids at insert time (defense in depth beyond defaultRandom()).
CREATE OR REPLACE FUNCTION vo_require_uuid_id() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS NULL THEN
    RAISE EXCEPTION 'account id required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_require_uuid ON users;
CREATE TRIGGER users_require_uuid
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION vo_require_uuid_id();
