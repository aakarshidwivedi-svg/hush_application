import { devStore, isDbUnavailable } from '../../db/devStore.js';
import { notFound } from '../../http/errors.js';
export async function listCommunities(pool, user, category) {
    try {
        const params = [user.campusId, user.id];
        let catFilter = '';
        if (category && category !== 'All') {
            params.push(category);
            catFilter = `AND c.category = $${params.length}`;
        }
        const { rows } = await pool.query(`SELECT c.id, c.campus_id, c.name, c.slug, c.description, c.icon, c.category,
              c.member_count, c.post_count,
              EXISTS (
                SELECT 1 FROM community_memberships cm
                 WHERE cm.community_id = c.id AND cm.user_id = $2
              ) AS is_member,
              c.created_at
         FROM communities c
        WHERE c.campus_id = $1 ${catFilter}
        ORDER BY c.member_count DESC, c.name ASC`, params);
        return rows.map((r) => ({
            id: r.id,
            campusId: r.campus_id,
            name: r.name,
            slug: r.slug,
            description: r.description,
            icon: r.icon,
            category: r.category,
            memberCount: Number(r.member_count),
            postCount: Number(r.post_count),
            isMember: Boolean(r.is_member),
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.listCommunities(user.campusId, user.id, category);
        }
        throw err;
    }
}
export async function getCommunity(pool, user, communityIdOrSlug) {
    try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityIdOrSlug);
        const filterCol = isUuid ? 'c.id' : 'c.slug';
        const { rows } = await pool.query(`SELECT c.id, c.campus_id, c.name, c.slug, c.description, c.icon, c.category,
              c.member_count, c.post_count,
              EXISTS (
                SELECT 1 FROM community_memberships cm
                 WHERE cm.community_id = c.id AND cm.user_id = $2
              ) AS is_member,
              c.created_at
         FROM communities c
        WHERE c.campus_id = $1 AND ${filterCol} = $3`, [user.campusId, user.id, communityIdOrSlug]);
        const row = rows[0];
        if (!row)
            throw notFound('Community not found');
        return {
            id: row.id,
            campusId: row.campus_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            icon: row.icon,
            category: row.category,
            memberCount: Number(row.member_count),
            postCount: Number(row.post_count),
            isMember: Boolean(row.is_member),
            createdAt: row.created_at.toISOString(),
        };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.getCommunity(user.campusId, user.id, communityIdOrSlug);
        }
        throw err;
    }
}
export async function joinCommunity(pool, user, communityId) {
    try {
        const inserted = await pool.query(`INSERT INTO community_memberships (community_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [communityId, user.id]);
        if (inserted.rowCount && inserted.rowCount > 0) {
            await pool.query(`UPDATE communities SET member_count = member_count + 1 WHERE id = $1`, [communityId]);
        }
        return { joined: true };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.joinCommunity(user.id, communityId);
        }
        throw err;
    }
}
export async function leaveCommunity(pool, user, communityId) {
    try {
        const deleted = await pool.query(`DELETE FROM community_memberships
        WHERE community_id = $1 AND user_id = $2`, [communityId, user.id]);
        if (deleted.rowCount && deleted.rowCount > 0) {
            await pool.query(`UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1`, [communityId]);
        }
        return { joined: false };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.leaveCommunity(user.id, communityId);
        }
        throw err;
    }
}
export async function listPosts(pool, user, communityId, limit = 30) {
    try {
        const { rows } = await pool.query(`SELECT p.id, p.community_id, p.author_id,
              pr.nickname, pr.avatar_url, pr.major, pr.graduation_year,
              p.title, p.content, p.likes_count, p.replies_count, p.is_pinned,
              EXISTS (
                SELECT 1 FROM community_post_likes pl
                 WHERE pl.post_id = p.id AND pl.user_id = $2
              ) AS has_liked,
              p.created_at
         FROM community_posts p
         JOIN users u ON u.id = p.author_id
         JOIN profiles pr ON pr.user_id = u.id
        WHERE p.community_id = $1
        ORDER BY p.is_pinned DESC, p.created_at DESC
        LIMIT $3`, [communityId, user.id, limit]);
        return rows.map((r) => ({
            id: r.id,
            communityId: r.community_id,
            author: {
                id: r.author_id,
                nickname: r.nickname,
                avatarUrl: r.avatar_url,
                major: r.major,
                graduationYear: r.graduation_year,
            },
            title: r.title,
            content: r.content,
            likesCount: Number(r.likes_count),
            repliesCount: Number(r.replies_count),
            isPinned: Boolean(r.is_pinned),
            hasLiked: Boolean(r.has_liked),
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.listCommunityPosts(communityId, user.id, limit);
        }
        throw err;
    }
}
export async function createPost(pool, user, communityId, input) {
    try {
        const { rows } = await pool.query(`INSERT INTO community_posts (community_id, campus_id, author_id, title, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`, [communityId, user.campusId, user.id, input.title, input.content]);
        const inserted = rows[0];
        await pool.query(`UPDATE communities SET post_count = post_count + 1 WHERE id = $1`, [communityId]);
        // Auto-join if not already a member
        await joinCommunity(pool, user, communityId).catch(() => { });
        // Fetch author profile
        const authorRes = await pool.query(`SELECT nickname, avatar_url, major, graduation_year FROM profiles WHERE user_id = $1`, [user.id]);
        const author = authorRes.rows[0];
        return {
            id: inserted.id,
            communityId,
            author: {
                id: user.id,
                nickname: author?.nickname ?? 'Student',
                avatarUrl: author?.avatar_url ?? null,
                major: author?.major ?? null,
                graduationYear: author?.graduation_year ?? null,
            },
            title: input.title,
            content: input.content,
            likesCount: 0,
            repliesCount: 0,
            isPinned: false,
            hasLiked: false,
            createdAt: inserted.created_at.toISOString(),
        };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.createCommunityPost(user, communityId, input);
        }
        throw err;
    }
}
export async function togglePostLike(pool, user, postId) {
    try {
        const existing = await pool.query(`SELECT 1 FROM community_post_likes WHERE post_id = $1 AND user_id = $2`, [postId, user.id]);
        if (existing.rowCount && existing.rowCount > 0) {
            await pool.query(`DELETE FROM community_post_likes WHERE post_id = $1 AND user_id = $2`, [postId, user.id]);
            const res = await pool.query(`UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1 RETURNING likes_count`, [postId]);
            return { hasLiked: false, likesCount: res.rows[0]?.likes_count ?? 0 };
        }
        else {
            await pool.query(`INSERT INTO community_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, user.id]);
            const res = await pool.query(`UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count`, [postId]);
            return { hasLiked: true, likesCount: res.rows[0]?.likes_count ?? 1 };
        }
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.toggleCommunityPostLike(user.id, postId);
        }
        throw err;
    }
}
export async function listReplies(pool, _user, postId) {
    try {
        const { rows } = await pool.query(`SELECT r.id, r.post_id, r.author_id,
              pr.nickname, pr.avatar_url, pr.major, pr.graduation_year,
              r.content, r.created_at
         FROM community_post_replies r
         JOIN users u ON u.id = r.author_id
         JOIN profiles pr ON pr.user_id = u.id
        WHERE r.post_id = $1
        ORDER BY r.created_at ASC`, [postId]);
        return rows.map((r) => ({
            id: r.id,
            postId: r.post_id,
            author: {
                id: r.author_id,
                nickname: r.nickname,
                avatarUrl: r.avatar_url,
                major: r.major,
                graduationYear: r.graduation_year,
            },
            content: r.content,
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.listCommunityPostReplies(postId);
        }
        throw err;
    }
}
export async function createReply(pool, user, postId, input) {
    try {
        const { rows } = await pool.query(`INSERT INTO community_post_replies (post_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`, [postId, user.id, input.content]);
        const inserted = rows[0];
        await pool.query(`UPDATE community_posts SET replies_count = replies_count + 1 WHERE id = $1`, [postId]);
        // Fetch author profile
        const authorRes = await pool.query(`SELECT nickname, avatar_url, major, graduation_year FROM profiles WHERE user_id = $1`, [user.id]);
        const author = authorRes.rows[0];
        return {
            id: inserted.id,
            postId,
            author: {
                id: user.id,
                nickname: author?.nickname ?? 'Student',
                avatarUrl: author?.avatar_url ?? null,
                major: author?.major ?? null,
                graduationYear: author?.graduation_year ?? null,
            },
            content: input.content,
            createdAt: inserted.created_at.toISOString(),
        };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.createCommunityPostReply(user, postId, input);
        }
        throw err;
    }
}
