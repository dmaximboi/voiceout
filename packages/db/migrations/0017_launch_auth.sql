DO $$
BEGIN
  ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'telegram';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
