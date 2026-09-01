-- Tighten media reads so unpublished/private files are not listed to guests.
-- App role (voiceout_app) is created by `pnpm db:gate`; this file only tightens policies.

CREATE OR REPLACE FUNCTION vo_media_published(mid uuid, kind text) RETURNS boolean AS $$
  SELECT
    CASE kind
      WHEN 'avatar' THEN true
      WHEN 'post_audio' THEN EXISTS (
        SELECT 1 FROM posts p WHERE p.media_id = mid AND p.status = 'published'
      )
      WHEN 'post_image' THEN EXISTS (
        SELECT 1 FROM posts p WHERE p.status = 'published' AND p.image_ids @> ARRAY[mid]::uuid[]
      )
      WHEN 'comment_audio' THEN EXISTS (
        SELECT 1
        FROM comments c
        JOIN posts p ON p.id = c.post_id
        WHERE c.media_id = mid AND p.status = 'published'
      )
      ELSE false
    END;
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS media_select ON media_objects;
CREATE POLICY media_select ON media_objects FOR SELECT USING (
  vo_rls_off()
  OR vo_is_user(user_id)
  OR (status = 'ready' AND vo_media_published(id, kind::text))
);

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
