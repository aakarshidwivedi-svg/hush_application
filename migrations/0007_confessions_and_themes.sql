-- 0007: Campus Anonymous Confessions Wall & Profile Customization Themes
-- Plain SQL migration, additive only.

-- 1. Table: confessions
CREATE TABLE IF NOT EXISTS "confessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campus_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'Crushes',
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    "likes_count" INT NOT NULL DEFAULT 0,
    "reports_count" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewer_id" UUID,
    CONSTRAINT "confessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "confessions_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "confessions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "confessions_status_chk" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'REMOVED')),
    CONSTRAINT "confessions_content_len_chk" CHECK (char_length("content") BETWEEN 5 AND 1000)
);

CREATE INDEX IF NOT EXISTS "confessions_campus_status_created_idx" ON "confessions"("campus_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "confessions_author_id_idx" ON "confessions"("author_id");
CREATE INDEX IF NOT EXISTS "confessions_category_idx" ON "confessions"("campus_id", "category");
ALTER TABLE "confessions" ENABLE ROW LEVEL SECURITY;

-- 2. Table: confession_likes
CREATE TABLE IF NOT EXISTS "confession_likes" (
    "confession_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "confession_likes_pkey" PRIMARY KEY ("confession_id", "user_id"),
    CONSTRAINT "confession_likes_confession_id_fkey" FOREIGN KEY ("confession_id") REFERENCES "confessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "confession_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "confession_likes_user_id_idx" ON "confession_likes"("user_id");
ALTER TABLE "confession_likes" ENABLE ROW LEVEL SECURITY;

-- 3. Table: confession_reports
CREATE TABLE IF NOT EXISTS "confession_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "confession_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" VARCHAR(50) NOT NULL,
    "details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    CONSTRAINT "confession_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "confession_reports_confession_id_fkey" FOREIGN KEY ("confession_id") REFERENCES "confessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "confession_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "confession_reports_unique_reporter" UNIQUE ("confession_id", "reporter_id"),
    CONSTRAINT "confession_reports_status_chk" CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED'))
);

CREATE INDEX IF NOT EXISTS "confession_reports_status_idx" ON "confession_reports"("status", "created_at" ASC);
ALTER TABLE "confession_reports" ENABLE ROW LEVEL SECURITY;

-- 4. Extend profiles table with optional ethical theme customizations
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "theme_style" VARCHAR(50) DEFAULT 'bubblegum';
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "chat_bubble_color" VARCHAR(50) DEFAULT 'lavender';
