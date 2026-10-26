import { withTx } from '../../db/pool.js';
import { notFound } from '../../http/errors.js';
import { lockPair } from '../shared/pairLock.js';
/**
 * Block a person. Runs under the pair lock so it serialises with crushes, messages and
 * unmatch on the same pair. In one transaction it:
 *  - stores the block (idempotent),
 *  - deletes any crush either person had sent the other (no stale interest survives a block),
 *  - ends any active match, so the conversation disappears for both people.
 * The target must be a live account on the caller's campus; anything else is an identical 404,
 * so the endpoint cannot be used to probe which ids exist.
 */
export async function blockUser(pool, blocker, targetId) {
    await withTx(pool, async (c) => {
        await lockPair(c, blocker.id, targetId);
        const target = await c.query(`SELECT 1 FROM users WHERE id = $1 AND campus_id = $2 AND account_status <> 'DELETED'`, [targetId, blocker.campusId]);
        if (target.rowCount === 0)
            throw notFound('Person not found');
        await c.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [blocker.id, targetId]);
        await c.query(`DELETE FROM crushes
        WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`, [blocker.id, targetId]);
        await c.query(`UPDATE matches SET status = 'UNMATCHED', unmatched_at = now(), unmatched_by = $1
        WHERE status = 'ACTIVE'
          AND user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)`, [blocker.id, targetId]);
    });
}
/**
 * Remove the caller's own block. Always succeeds identically. Unblocking does not restore a
 * match that the block ended, and the other person's own block (if any) is unaffected.
 */
export async function unblockUser(pool, blocker, targetId) {
    await withTx(pool, async (c) => {
        await lockPair(c, blocker.id, targetId);
        await c.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blocker.id, targetId]);
    });
}
/** The caller's own block list (never who has blocked the caller). */
export async function listBlocked(db, userId) {
    const { rows } = await db.query(`SELECT b.blocked_id AS id, p.nickname, b.created_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id AND u.account_status <> 'DELETED'
       JOIN profiles p ON p.user_id = b.blocked_id
      WHERE b.blocker_id = $1
      ORDER BY b.created_at DESC
      LIMIT 200`, [userId]);
    return rows.map((r) => ({ id: r.id, nickname: r.nickname, blockedAt: r.created_at }));
}
