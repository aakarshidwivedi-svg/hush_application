-- 0009: Campus Communities, Friendship Connection Requests, and Multi-Intent Networking
-- Plain SQL migration, additive only.

-- 1. Extend profiles with connection intent (Dating, Friends, Both)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "intent" VARCHAR(20) DEFAULT 'BOTH';
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_intent_chk" CHECK ("intent" IN ('DATING', 'FRIENDS', 'BOTH'));

-- 2. Table: friendship_requests
CREATE TABLE IF NOT EXISTS "friendship_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friendship_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "friendship_requests_sender_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "friendship_requests_receiver_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "friendship_requests_no_self" CHECK ("sender_id" <> "receiver_id"),
    CONSTRAINT "friendship_requests_unique_pair" UNIQUE ("sender_id", "receiver_id"),
    CONSTRAINT "friendship_requests_status_chk" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS "friendship_requests_receiver_status_idx" ON "friendship_requests"("receiver_id", "status");
CREATE INDEX IF NOT EXISTS "friendship_requests_sender_status_idx" ON "friendship_requests"("sender_id", "status");
ALTER TABLE "friendship_requests" ENABLE ROW LEVEL SECURITY;

-- 3. Table: connections (accepted campus friendships)
CREATE TABLE IF NOT EXISTS "connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_a" UUID NOT NULL,
    "user_b" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connections_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "connections_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "connections_canonical_order_chk" CHECK ("user_a" < "user_b"),
    CONSTRAINT "connections_unique_pair" UNIQUE ("user_a", "user_b")
);

CREATE INDEX IF NOT EXISTS "connections_user_a_idx" ON "connections"("user_a");
CREATE INDEX IF NOT EXISTS "connections_user_b_idx" ON "connections"("user_b");
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;

-- 4. Table: communities
CREATE TABLE IF NOT EXISTS "communities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "icon" VARCHAR(20) NOT NULL DEFAULT '🏛️',
    "category" VARCHAR(50) NOT NULL,
    "member_count" INT NOT NULL DEFAULT 0,
    "post_count" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "communities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "communities_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE,
    CONSTRAINT "communities_campus_slug_key" UNIQUE ("campus_id", "slug")
);

CREATE INDEX IF NOT EXISTS "communities_campus_category_idx" ON "communities"("campus_id", "category");
ALTER TABLE "communities" ENABLE ROW LEVEL SECURITY;

-- 5. Table: community_memberships
CREATE TABLE IF NOT EXISTS "community_memberships" (
    "community_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_memberships_pkey" PRIMARY KEY ("community_id", "user_id"),
    CONSTRAINT "community_memberships_community_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE,
    CONSTRAINT "community_memberships_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "community_memberships_role_chk" CHECK ("role" IN ('MEMBER', 'MODERATOR', 'ADMIN'))
);

CREATE INDEX IF NOT EXISTS "community_memberships_user_idx" ON "community_memberships"("user_id");
ALTER TABLE "community_memberships" ENABLE ROW LEVEL SECURITY;

-- 6. Table: community_posts
CREATE TABLE IF NOT EXISTS "community_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "community_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "likes_count" INT NOT NULL DEFAULT 0,
    "replies_count" INT NOT NULL DEFAULT 0,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_posts_community_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE,
    CONSTRAINT "community_posts_campus_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE,
    CONSTRAINT "community_posts_author_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "community_posts_community_created_idx" ON "community_posts"("community_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "community_posts_campus_idx" ON "community_posts"("campus_id");
ALTER TABLE "community_posts" ENABLE ROW LEVEL SECURITY;

-- 7. Table: community_post_replies
CREATE TABLE IF NOT EXISTS "community_post_replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_post_replies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_post_replies_post_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE,
    CONSTRAINT "community_post_replies_author_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "community_post_replies_post_created_idx" ON "community_post_replies"("post_id", "created_at" ASC);
ALTER TABLE "community_post_replies" ENABLE ROW LEVEL SECURITY;

-- 8. Table: community_post_likes
CREATE TABLE IF NOT EXISTS "community_post_likes" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_post_likes_pkey" PRIMARY KEY ("post_id", "user_id"),
    CONSTRAINT "community_post_likes_post_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE,
    CONSTRAINT "community_post_likes_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

ALTER TABLE "community_post_likes" ENABLE ROW LEVEL SECURITY;
