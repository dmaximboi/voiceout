-- The media_select policy and mediaAccess look up which post/comment uses a media id;
-- bookmark counts group by post. Without these every lookup is a full table scan.
CREATE INDEX IF NOT EXISTS posts_media_idx ON posts (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_image_ids_gin_idx ON posts USING gin (image_ids);
CREATE INDEX IF NOT EXISTS comments_media_idx ON comments (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookmarks_post_idx ON bookmarks (post_id);
