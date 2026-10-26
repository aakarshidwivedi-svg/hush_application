import { withTx } from '../../db/pool.js';
import { notFound } from '../../http/errors.js';
import { eligibleUserSql } from '../shared/eligibility.js';
import { lockPair } from '../shared/pairLock.js';
/**
 * Record a secret crush and, if the other person already has one on file for the sender,
 * create exactly one match — all in one transaction.
 *
 * The caller always receives the same generic result, so the response never reveals whether
 * the interest was one-sided, reciprocated, or ignored (e.g. after an earlier unmatch).
 * Users learn about a match only through the notification row written in the same commit.
 */
export async function sendCrush(pool, sender, receiverId) {
    await withTx(pool, async (c) => {
        // 1. Serialise everything touching this pair (see pairLock.ts).
        await lockPair(c, sender.id, receiverId);
        // 2. Validate the recipient *inside* the lock: exists, same campus, eligible, active,
        //    discoverable, and no block in either direction. All failures look identical (404).
        const target = await c.query(`SELECT 1
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         JOIN campuses c ON c.id = u.campus_id
        WHERE u.id = $1
          AND u.campus_id = $2
          AND p.discoverable
          AND ${eligibleUserSql('u', 'c')}
          AND NOT EXISTS (SELECT 1 FROM blocks b
                           WHERE (b.blocker_id = $3 AND b.blocked_id = u.id)
                              OR (b.blocker_id = u.id AND b.blocked_id = $3))`, [receiverId, sender.campusId, sender.id]);
        if (target.rowCount === 0)
            throw notFound('Person not found');
        // 3. A pair that has ever matched (active or unmatched) cannot be re-matched. Treat the
        //    request as a silent no-op so an unmatch is final and nothing is stored.
        const prior = await c.query('SELECT 1 FROM matches WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)', [sender.id, receiverId]);
        if (prior.rowCount)
            return;
        // 4. Store the crush privately; the unique (sender, receiver) constraint makes repeats harmless.
        await c.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $2) ON CONFLICT (sender_id, receiver_id) DO NOTHING', [sender.id, receiverId]);
        // 5. Reciprocal interest? The pair lock guarantees we see any committed opposite crush.
        const reciprocal = await c.query('SELECT 1 FROM crushes WHERE sender_id = $1 AND receiver_id = $2', [receiverId, sender.id]);
        if (reciprocal.rowCount === 0)
            return;
        // 6. Create exactly one match in canonical order; ON CONFLICT is a backstop to the lock.
        const match = await c.query(`INSERT INTO matches (user_a, user_b)
       VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
       ON CONFLICT (user_a, user_b) DO NOTHING
       RETURNING id`, [sender.id, receiverId]);
        const matchId = match.rows[0]?.id;
        if (!matchId)
            return;
        // 7. Notify both people — same transaction, so only a committed match is ever announced —
        //    and drop the now-redundant crush records (data minimisation).
        await c.query(`INSERT INTO notifications (user_id, type, match_id) VALUES ($1, 'MATCH', $3), ($2, 'MATCH', $3)`, [
            sender.id,
            receiverId,
            matchId,
        ]);
        await c.query(`DELETE FROM crushes
        WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`, [sender.id, receiverId]);
    });
}
/** Withdraw the caller's own crush. Always succeeds identically, whether or not one existed. */
export async function withdrawCrush(pool, sender, receiverId) {
    await withTx(pool, async (c) => {
        await lockPair(c, sender.id, receiverId);
        await c.query('DELETE FROM crushes WHERE sender_id = $1 AND receiver_id = $2', [sender.id, receiverId]);
    });
}
