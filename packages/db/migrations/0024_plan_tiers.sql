ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier varchar(16);

UPDATE users
SET plan_tier = 'gold'
WHERE studio_until > now()
  AND (plan_tier IS NULL OR plan_tier = '');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_tier_check;
ALTER TABLE users ADD CONSTRAINT users_plan_tier_check
  CHECK (plan_tier IS NULL OR plan_tier IN ('basic', 'verified', 'gold'));
