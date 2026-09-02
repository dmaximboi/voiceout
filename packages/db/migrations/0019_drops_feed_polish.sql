CREATE INDEX IF NOT EXISTS notifications_unread_user_idx
  ON notifications (user_id)
  WHERE read_at IS NULL;
