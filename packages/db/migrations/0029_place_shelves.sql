ALTER TABLE users ADD COLUMN IF NOT EXISTS city varchar(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country varchar(8);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS shelf varchar(24);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS topic varchar(24);

CREATE INDEX IF NOT EXISTS users_place_idx ON users (country, city)
  WHERE country IS NOT NULL AND country <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS posts_shelf_idx ON posts (shelf)
  WHERE shelf IS NOT NULL AND shelf <> '';
