-- 0006: Support message notifications, discovery interest indexing, and moderation reporting performance
-- Plain SQL migration, additive only.

-- 1. Extend notifications to support both mutual matches and new incoming messages
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_chk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_chk" CHECK ("type" IN ('MATCH', 'MESSAGE'));

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "actor_id" UUID REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "summary" TEXT;

-- Index for fast user unread queries
CREATE INDEX IF NOT EXISTS "notifications_user_read_idx" ON "notifications"("user_id", "read_at");

-- 2. Discovery performance & shared interest matching indexes
CREATE INDEX IF NOT EXISTS "profiles_discoverable_user_idx" ON "profiles"("discoverable", "user_id");
CREATE INDEX IF NOT EXISTS "profiles_interests_gin_idx" ON "profiles" USING GIN ("interests");

-- 3. Moderation performance indexes
CREATE INDEX IF NOT EXISTS "reports_status_created_idx" ON "reports"("status", "created_at" ASC);
CREATE INDEX IF NOT EXISTS "reports_reason_idx" ON "reports"("reason");
