ALTER TABLE users ADD COLUMN IF NOT EXISTS lang varchar(8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS region varchar(8);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS region varchar(8);

CREATE INDEX IF NOT EXISTS posts_region_idx ON posts (region)
  WHERE region IS NOT NULL AND region <> '';

CREATE INDEX IF NOT EXISTS users_region_idx ON users (region)
  WHERE region IS NOT NULL AND region <> '' AND deleted_at IS NULL;
