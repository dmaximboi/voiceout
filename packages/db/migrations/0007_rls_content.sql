-- Content + social RLS. Same bypass as 0006: policies apply when app.rls = 'on'
-- (authenticated API requests). Guests and internal jobs set app.rls = 'off'.
-- Superusers (Docker POSTGRES_USER) still bypass RLS; use a non-superuser app role
-- in production for these policies to bind.

CREATE OR REPLACE FUNCTION vo_rls_off() RETURNS boolean AS $$
  SELECT current_setting('app.rls', true) IS DISTINCT FROM 'on';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION vo_is_user(uid uuid) RETURNS boolean AS $$
  SELECT uid::text = current_setting('app.user_id', true);
$$ LANGUAGE sql STABLE;

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posts_select ON posts;
CREATE POLICY posts_select ON posts FOR SELECT USING (
  vo_rls_off() OR status = 'published' OR vo_is_user(author_id)
);
DROP POLICY IF EXISTS posts_insert ON posts;
CREATE POLICY posts_insert ON posts FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(author_id)
);
DROP POLICY IF EXISTS posts_update ON posts;
CREATE POLICY posts_update ON posts FOR UPDATE USING (
  vo_rls_off() OR vo_is_user(author_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(author_id)
);
DROP POLICY IF EXISTS posts_delete ON posts;
CREATE POLICY posts_delete ON posts FOR DELETE USING (
  vo_rls_off() OR vo_is_user(author_id)
);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_select ON comments;
CREATE POLICY comments_select ON comments FOR SELECT USING (
  vo_rls_off()
  OR vo_is_user(author_id)
  OR EXISTS (SELECT 1 FROM posts p WHERE p.id = comments.post_id AND p.status = 'published')
);
DROP POLICY IF EXISTS comments_write ON comments;
CREATE POLICY comments_write ON comments USING (
  vo_rls_off() OR vo_is_user(author_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(author_id)
);

ALTER TABLE media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_select ON media_objects;
CREATE POLICY media_select ON media_objects FOR SELECT USING (
  vo_rls_off() OR status = 'ready' OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS media_write ON media_objects;
CREATE POLICY media_write ON media_objects USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(actor_id)
);
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications FOR DELETE USING (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follows_select ON follows;
CREATE POLICY follows_select ON follows FOR SELECT USING (true);
DROP POLICY IF EXISTS follows_write ON follows;
CREATE POLICY follows_write ON follows USING (
  vo_rls_off() OR vo_is_user(follower_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(follower_id)
);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blocks_access ON blocks;
CREATE POLICY blocks_access ON blocks USING (
  vo_rls_off() OR vo_is_user(blocker_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(blocker_id)
);

ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mutes_access ON mutes;
CREATE POLICY mutes_access ON mutes USING (
  vo_rls_off() OR vo_is_user(muter_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(muter_id)
);

ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_reactions_select ON post_reactions;
CREATE POLICY post_reactions_select ON post_reactions FOR SELECT USING (true);
DROP POLICY IF EXISTS post_reactions_write ON post_reactions;
CREATE POLICY post_reactions_write ON post_reactions USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_likes_select ON comment_likes;
CREATE POLICY comment_likes_select ON comment_likes FOR SELECT USING (true);
DROP POLICY IF EXISTS comment_likes_write ON comment_likes;
CREATE POLICY comment_likes_write ON comment_likes USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookmarks_access ON bookmarks;
CREATE POLICY bookmarks_access ON bookmarks USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reposts_select ON reposts;
CREATE POLICY reposts_select ON reposts FOR SELECT USING (true);
DROP POLICY IF EXISTS reposts_write ON reposts;
CREATE POLICY reposts_write ON reposts USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE voices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voices_select ON voices;
CREATE POLICY voices_select ON voices FOR SELECT USING (true);
DROP POLICY IF EXISTS voices_write ON voices;
CREATE POLICY voices_write ON voices USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE seen_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seen_posts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seen_posts_access ON seen_posts;
CREATE POLICY seen_posts_access ON seen_posts USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE listen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE listen_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listen_events_access ON listen_events;
CREATE POLICY listen_events_access ON listen_events USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reports_select ON reports;
CREATE POLICY reports_select ON reports FOR SELECT USING (
  vo_rls_off() OR vo_is_user(reporter_id)
);
DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(reporter_id)
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (vo_rls_off());
DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT USING (vo_rls_off());

ALTER TABLE trending_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE trending_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trending_select ON trending_snapshots;
CREATE POLICY trending_select ON trending_snapshots FOR SELECT USING (true);
DROP POLICY IF EXISTS trending_write ON trending_snapshots;
CREATE POLICY trending_write ON trending_snapshots USING (vo_rls_off()) WITH CHECK (vo_rls_off());
