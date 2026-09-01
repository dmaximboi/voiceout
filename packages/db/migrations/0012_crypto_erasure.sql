-- Cryptographic erasure for deleted accounts.
-- Live private fields (email) are sealed with a per-user DEK wrapped by DATA_KEK.
-- Deleting the wrapped DEK makes remaining ciphertext unreadable (crypto-shred).
-- The user row is tombstoned, not CASCADE-deleted, so public graph FKs stay valid.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS erased_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hmac varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_ct text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_nonce text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_hmac_idx ON users (email_hmac) WHERE email_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON users (deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_keys (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  wrapped_dek text NOT NULL,
  wrap_nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_keys_access ON user_keys;
CREATE POLICY user_keys_access ON user_keys
  USING (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users
  FOR SELECT
  USING (
    deleted_at IS NULL
    OR current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR id::text = current_setting('app.user_id', true)
  );

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);
CREATE INDEX IF NOT EXISTS mutes_muted_idx ON mutes (muted_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceout_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_keys TO voiceout_app;
  END IF;
END $$;
