ALTER TABLE posts ADD COLUMN IF NOT EXISTS comment_emotion varchar(16);

CREATE INDEX IF NOT EXISTS posts_lang_idx ON posts (lang)
  WHERE lang IS NOT NULL AND lang <> '';

CREATE INDEX IF NOT EXISTS posts_comment_emotion_idx ON posts (comment_emotion)
  WHERE comment_emotion IS NOT NULL AND comment_emotion <> '';
