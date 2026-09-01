ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_name_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
