-- 0005: profile photos and normalized canonical interests catalog. Additive only.

-- Table: profile_photos
CREATE TABLE "profile_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "storage_path" TEXT NOT NULL,
    "display_order" INT NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "profile_photos_display_order_range_chk" CHECK ("display_order" BETWEEN 0 AND 5)
);

CREATE INDEX "profile_photos_user_display_order_idx" ON "profile_photos"("user_id", "display_order" ASC);
CREATE UNIQUE INDEX "profile_photos_one_primary_per_user_idx" ON "profile_photos"("user_id") WHERE "is_primary" = true;
ALTER TABLE "profile_photos" ENABLE ROW LEVEL SECURITY;

-- Table: interests
CREATE TABLE "interests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "interests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interests_category_name_key" UNIQUE ("category", "name")
);

CREATE INDEX "interests_category_idx" ON "interests"("category");
CREATE INDEX "interests_is_active_idx" ON "interests"("is_active");
ALTER TABLE "interests" ENABLE ROW LEVEL SECURITY;

-- Table: user_interests
CREATE TABLE "user_interests" (
    "user_id" UUID NOT NULL,
    "interest_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id", "interest_id"),
    CONSTRAINT "user_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_interests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_interests_interest_id_idx" ON "user_interests"("interest_id");
ALTER TABLE "user_interests" ENABLE ROW LEVEL SECURITY;

-- Predefined canonical interests
INSERT INTO "interests" ("category", "name", "is_active") VALUES
-- Music
('Music', 'Pop', true),
('Music', 'Indie', true),
('Music', 'Bollywood', true),
('Music', 'Hip-hop', true),
('Music', 'Classical', true),
('Music', 'Live concerts', true),

-- Entertainment
('Entertainment', 'Movies', true),
('Entertainment', 'Anime', true),
('Entertainment', 'K-dramas', true),
('Entertainment', 'Web series', true),
('Entertainment', 'Gaming', true),
('Entertainment', 'Memes', true),

-- Food
('Food', 'Coffee', true),
('Food', 'Cafes', true),
('Food', 'Street food', true),
('Food', 'Desserts', true),
('Food', 'Cooking', true),
('Food', 'Trying new restaurants', true),

-- Lifestyle
('Lifestyle', 'Gym', true),
('Lifestyle', 'Reading', true),
('Lifestyle', 'Travelling', true),
('Lifestyle', 'Photography', true),
('Lifestyle', 'Fashion', true),
('Lifestyle', 'Art', true),
('Lifestyle', 'Dancing', true),
('Lifestyle', 'Sports', true),

-- Personality and social preferences
('Personality and social preferences', 'Introvert', true),
('Personality and social preferences', 'Extrovert', true),
('Personality and social preferences', 'Ambivert', true),
('Personality and social preferences', 'Deep conversations', true),
('Personality and social preferences', 'Spontaneous plans', true),
('Personality and social preferences', 'Quiet dates', true),
('Personality and social preferences', 'Late-night talks', true),
('Personality and social preferences', 'Study dates', true),

-- Academic and creative
('Academic and creative', 'Coding', true),
('Academic and creative', 'Startups', true),
('Academic and creative', 'Design', true),
('Academic and creative', 'AI and technology', true),
('Academic and creative', 'Writing', true),
('Academic and creative', 'Entrepreneurship', true)
ON CONFLICT ("category", "name") DO NOTHING;
