-- 0008: College Batch, Major & Campus Area attributes for rich student discovery
-- Plain SQL migration, additive only.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "graduation_year" VARCHAR(30);
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "major" VARCHAR(60);
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "campus_area" VARCHAR(60);

CREATE INDEX IF NOT EXISTS "profiles_major_idx" ON "profiles"("major");
CREATE INDEX IF NOT EXISTS "profiles_grad_year_idx" ON "profiles"("graduation_year");
