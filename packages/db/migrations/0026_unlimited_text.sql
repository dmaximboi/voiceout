-- Widen caption/comment text for verified/gold unlimited plans.
ALTER TABLE posts ALTER COLUMN caption TYPE text;
ALTER TABLE comments ALTER COLUMN body TYPE text;
