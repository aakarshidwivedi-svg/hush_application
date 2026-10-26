import { z } from 'zod';
import { withTx } from '../../db/pool.js';
import { deleteUserPhotosDir } from '../photos/storage.js';
export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') }).strict();
/** Closed reports are kept this long after resolution; tombstones follow once none remain. */
export const RETENTION_DAYS = 90;
/**
 * Delete the caller's account (see README "Data retention"). One transaction:
 *  - erases profile (bio, avatar, nickname), photos, interests, conversations, crushes, notifications and blocks,
 *  - ends active matches,
 *  - leaves a bare tombstone row (`DELETED`, no personal data) so reports stay intact and the
 *    identity cannot silently re-register.
 * Idempotency: the loadUser middleware rejects tokens of deleted accounts, so a repeat is a 401.
 */
export async function deleteAccount(pool, userId) {
    await withTx(pool, async (c) => {
        // Row lock serialises with moderation actions on the same account.
        await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await c.query(`UPDATE users SET account_status = 'DELETED', deleted_at = now() WHERE id = $1`, [userId]);
        await c.query('DELETE FROM messages WHERE match_id IN (SELECT id FROM matches WHERE user_a = $1 OR user_b = $1)', [userId]);
        await c.query(`UPDATE matches SET status = 'UNMATCHED', unmatched_at = now(), unmatched_by = $1
        WHERE status = 'ACTIVE' AND (user_a = $1 OR user_b = $1)`, [userId]);
        await c.query('DELETE FROM crushes WHERE sender_id = $1 OR receiver_id = $1', [userId]);
        await c.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
        await c.query('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [userId]);
        await c.query('DELETE FROM user_interests WHERE user_id = $1', [userId]);
        await c.query('DELETE FROM profile_photos WHERE user_id = $1', [userId]);
        await c.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    });
    // Remove orphaned files from storage
    await deleteUserPhotosDir(userId);
}
/**
 * Retention job (run daily, e.g. from a scheduler): removes closed reports older than the
 * retention window that involve deleted accounts, then tombstones with no remaining reports.
 * Live (OPEN/REVIEWING) reports always block purging.
 */
export async function purgeDeletedAccounts(pool, retentionDays = RETENTION_DAYS) {
    return withTx(pool, async (c) => {
        const cutoff = `now() - make_interval(days => $1)`;
        const reports = await c.query(`DELETE FROM reports r
        WHERE r.status IN ('ACTIONED', 'DISMISSED')
          AND COALESCE(r.reviewed_at, r.created_at) < ${cutoff}
          AND EXISTS (SELECT 1 FROM users u
                       WHERE u.id IN (r.reporter_id, r.target_id)
                         AND u.account_status = 'DELETED' AND u.deleted_at < ${cutoff})`, [retentionDays]);
        const users = await c.query(`DELETE FROM users u
        WHERE u.account_status = 'DELETED' AND u.deleted_at < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.reporter_id = u.id OR r.target_id = u.id)`, [retentionDays]);
        return { reports: reports.rowCount ?? 0, users: users.rowCount ?? 0 };
    });
}
