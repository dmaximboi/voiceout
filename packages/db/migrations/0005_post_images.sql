ALTER TYPE media_kind ADD VALUE IF NOT EXISTS 'post_image';

ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_ids uuid[] NOT NULL DEFAULT '{}';
