-- Hush initial schema

CREATE TYPE "AgeStatus" AS ENUM ('UNVERIFIED', 'SELF_ATTESTED', 'VERIFIED');
CREATE TYPE "CampusStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'UNMATCHED');
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'SPAM', 'FAKE_PROFILE', 'INAPPROPRIATE_CONTENT', 'UNDERAGE', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED');

CREATE TABLE "campuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "verification_config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_subject" TEXT NOT NULL,
    "campus_id" UUID NOT NULL,
    "age_status" "AgeStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "campus_status" "CampusStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "nickname" VARCHAR(24) NOT NULL,
    "nickname_key" VARCHAR(24) NOT NULL,
    "bio" VARCHAR(280) NOT NULL DEFAULT '',
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatar_url" TEXT,
    "discoverable" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "crushes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crushes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_a" UUID NOT NULL,
    "user_b" UUID NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatched_at" TIMESTAMPTZ(3),
    "unmatched_by" UUID,
    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id")
);

CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporter_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(1000),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- Unique constraints and indexes
CREATE UNIQUE INDEX "campuses_name_key" ON "campuses"("name");
CREATE UNIQUE INDEX "users_auth_subject_key" ON "users"("auth_subject");
CREATE INDEX "users_campus_id_idx" ON "users"("campus_id");
CREATE UNIQUE INDEX "profiles_nickname_key_key" ON "profiles"("nickname_key");
CREATE INDEX "profiles_discoverable_idx" ON "profiles"("discoverable");
CREATE UNIQUE INDEX "crushes_sender_id_receiver_id_key" ON "crushes"("sender_id", "receiver_id");
CREATE INDEX "crushes_receiver_id_idx" ON "crushes"("receiver_id");
CREATE UNIQUE INDEX "matches_user_a_user_b_key" ON "matches"("user_a", "user_b");
CREATE INDEX "matches_user_a_status_idx" ON "matches"("user_a", "status");
CREATE INDEX "matches_user_b_status_idx" ON "matches"("user_b", "status");
CREATE INDEX "messages_match_id_created_at_idx" ON "messages"("match_id", "created_at");
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_target_id_idx" ON "reports"("target_id");

-- Foreign keys
ALTER TABLE "users" ADD CONSTRAINT "users_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crushes" ADD CONSTRAINT "crushes_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crushes" ADD CONSTRAINT "crushes_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_fkey" FOREIGN KEY ("unmatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check constraints (enforced by the database, independent of application code)
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_nickname_format_chk" CHECK ("nickname" ~ '^[A-Za-z0-9_.]{3,24}$');
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_nickname_key_lower_chk" CHECK ("nickname_key" = lower("nickname"));
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_interests_max_chk" CHECK (cardinality("interests") <= 10);
ALTER TABLE "crushes" ADD CONSTRAINT "crushes_no_self_chk" CHECK ("sender_id" <> "receiver_id");
ALTER TABLE "matches" ADD CONSTRAINT "matches_canonical_order_chk" CHECK ("user_a" < "user_b");
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_length_chk" CHECK (char_length("content") BETWEEN 1 AND 1000);
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_no_self_chk" CHECK ("blocker_id" <> "blocked_id");
ALTER TABLE "reports" ADD CONSTRAINT "reports_no_self_chk" CHECK ("reporter_id" <> "target_id");

-- Defence in depth: these tables are only ever reached through the API.
-- Enable RLS with no policies so that any accidental direct (anon/authenticated)
-- access through Supabase's PostgREST layer is denied. The API connects with a
-- role that bypasses RLS (table owner / BYPASSRLS), see README.
ALTER TABLE "campuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crushes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
