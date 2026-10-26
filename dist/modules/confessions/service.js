import { devStore, isDbUnavailable } from '../../db/devStore.js';
import { AppError, notFound } from '../../http/errors.js';
// Regex to flag potential phone numbers or emails to prevent doxxing
const DOXXING_REGEX = /(\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
export async function getCampusConfessions(pool, user, category, limit = 30) {
    try {
        let query = `
      SELECT c.id, c.campus_id, c.content, c.category, c.likes_count, c.created_at,
             EXISTS(SELECT 1 FROM confession_likes cl WHERE cl.confession_id = c.id AND cl.user_id = $2) AS has_liked
        FROM confessions c
       WHERE c.campus_id = $1
         AND c.status = 'APPROVED'
    `;
        const params = [user.campusId, user.id];
        if (category && category !== 'All') {
            params.push(category);
            query += ` AND c.category = $${params.length}`;
        }
        query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const { rows } = await pool.query(query, params);
        return rows.map((r) => ({
            id: r.id,
            campusId: r.campus_id,
            content: r.content,
            category: r.category,
            likesCount: r.likes_count,
            hasLiked: r.has_liked,
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.getCampusConfessions(user.campusId, user.id, category, limit);
        }
        throw err;
    }
}
export async function createConfession(pool, user, input) {
    // Simple safety check: if phone/email detected, quarantine as PENDING for moderator review
    const containsSensitiveInfo = DOXXING_REGEX.test(input.content);
    const initialStatus = containsSensitiveInfo ? 'PENDING' : 'APPROVED';
    try {
        const { rows } = await pool.query(`INSERT INTO confessions (campus_id, author_id, content, category, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, campus_id, content, category, likes_count, created_at`, [user.campusId, user.id, input.content, input.category, initialStatus]);
        const r = rows[0];
        if (!r)
            throw new AppError(500, 'CONFESSION_FAILED', 'Failed to publish confession');
        return {
            id: r.id,
            campusId: r.campus_id,
            content: r.content,
            category: r.category,
            likesCount: r.likes_count,
            hasLiked: false,
            createdAt: r.created_at.toISOString(),
        };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.createConfession(user.campusId, user.id, input.content, input.category, initialStatus);
        }
        throw err;
    }
}
export async function toggleConfessionLike(pool, user, confessionId) {
    try {
        // Check if like exists
        const existing = await pool.query(`SELECT 1 FROM confession_likes WHERE confession_id = $1 AND user_id = $2`, [confessionId, user.id]);
        let liked = false;
        if (existing.rowCount && existing.rowCount > 0) {
            // Remove like
            await pool.query(`DELETE FROM confession_likes WHERE confession_id = $1 AND user_id = $2`, [confessionId, user.id]);
            await pool.query(`UPDATE confessions SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1`, [confessionId]);
            liked = false;
        }
        else {
            // Add like
            await pool.query(`INSERT INTO confession_likes (confession_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [confessionId, user.id]);
            await pool.query(`UPDATE confessions SET likes_count = likes_count + 1 WHERE id = $1`, [confessionId]);
            liked = true;
        }
        const countRes = await pool.query(`SELECT likes_count FROM confessions WHERE id = $1`, [confessionId]);
        const likesCount = countRes.rows[0]?.likes_count ?? 0;
        return { liked, likesCount };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.toggleConfessionLike(confessionId, user.id);
        }
        throw err;
    }
}
export async function reportConfession(pool, user, confessionId, input) {
    try {
        await pool.query(`INSERT INTO confession_reports (confession_id, reporter_id, reason, details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (confession_id, reporter_id) DO NOTHING`, [confessionId, user.id, input.reason, input.details ?? null]);
        // Increment report counter and quarantine if reports >= 3
        await pool.query(`UPDATE confessions
          SET reports_count = reports_count + 1,
              status = CASE WHEN reports_count + 1 >= 3 THEN 'PENDING' ELSE status END
        WHERE id = $1`, [confessionId]);
        return { success: true };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.reportConfession(confessionId, user.id, input.reason, input.details);
        }
        throw err;
    }
}
export async function getModerationConfessions(pool, statusFilter) {
    try {
        let query = `
      SELECT c.id, c.campus_id, c.content, c.category, c.status, c.likes_count, c.reports_count,
             c.created_at, c.reviewed_at
        FROM confessions c
    `;
        const params = [];
        if (statusFilter && statusFilter !== 'ALL') {
            params.push(statusFilter);
            query += ` WHERE c.status = $1`;
        }
        query += ` ORDER BY c.reports_count DESC, c.created_at DESC LIMIT 50`;
        const { rows } = await pool.query(query, params);
        return rows.map((r) => ({
            id: r.id,
            campusId: r.campus_id,
            content: r.content,
            category: r.category,
            status: r.status,
            likesCount: r.likes_count,
            reportsCount: r.reports_count,
            hasLiked: false,
            createdAt: r.created_at.toISOString(),
            reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.getModerationConfessions(statusFilter);
        }
        throw err;
    }
}
export async function moderateConfession(pool, moderatorId, confessionId, input) {
    const statusMap = {
        APPROVE: 'APPROVED',
        REJECT: 'REJECTED',
        REMOVE: 'REMOVED',
    };
    const newStatus = statusMap[input.action];
    try {
        const res = await pool.query(`UPDATE confessions
          SET status = $1, reviewed_at = CURRENT_TIMESTAMP, reviewer_id = $2
        WHERE id = $3`, [newStatus, moderatorId, confessionId]);
        if (res.rowCount === 0)
            throw notFound('Confession not found');
        return { success: true };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.moderateConfession(confessionId, input.action, moderatorId);
        }
        throw err;
    }
}
