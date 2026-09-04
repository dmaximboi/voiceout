-- Gold plan allows longer captions; widen column to match shared max.
ALTER TABLE posts ALTER COLUMN caption TYPE varchar(1000);
