-- 0002: notification inbox for matches, moderation bookkeeping, small schema hardening.
-- Additive only; 0001_init.sql is never edited after being applied.

ALTER TABLE "profiles" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "profiles" ALTER COLUMN "interests" SET NOT NULL;

-- A notification row is written in the same transaction that creates a match,
-- so users are only ever notified about matches that were successfully committed.
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "match_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_type_chk" CHECK ("type" IN ('MATCH')),
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notifications_user_unread_idx" ON "notifications"("user_id", "created_at" DESC) WHERE "read_at" IS NULL;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

-- Moderation bookkeeping on reports (moderator identity is an auth subject, never exposed to users).
ALTER TABLE "reports" ADD COLUMN "reviewed_by" TEXT;
ALTER TABLE "reports" ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);
ALTER TABLE "reports" ADD COLUMN "resolution_note" VARCHAR(500);
