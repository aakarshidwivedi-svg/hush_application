import { devStore, isDbUnavailable } from '../../db/devStore.js';
import { AppError, notFound } from '../../http/errors.js';
import { lockPair } from '../shared/pairLock.js';
import { withTx } from '../../db/pool.js';
export async function sendFriendRequest(pool, sender, receiverId) {
    if (sender.id === receiverId) {
        throw new AppError(400, 'CANNOT_REQUEST_SELF', 'Cannot send friend request to yourself');
    }
    try {
        return await withTx(pool, async (c) => {
            await lockPair(c, sender.id, receiverId);
            // Check if receiver is eligible, active, and on same campus
            const receiverRes = await c.query(`SELECT 1 FROM users u
           JOIN profiles p ON p.user_id = u.id
          WHERE u.id = $1 AND u.campus_id = $2
            AND NOT EXISTS (
              SELECT 1 FROM blocks b
               WHERE (b.blocker_id = $3 AND b.blocked_id = u.id)
                  OR (b.blocker_id = u.id AND b.blocked_id = $3)
            )`, [receiverId, sender.campusId, sender.id]);
            if (receiverRes.rowCount === 0)
                throw notFound('Student not found');
            // Check if already connected
            const existingConn = await c.query(`SELECT 1 FROM connections WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)`, [sender.id, receiverId]);
            if (existingConn.rowCount && existingConn.rowCount > 0) {
                return { status: 'already_connected' };
            }
            // Check if reciprocal pending request exists; if so, accept automatically!
            const reciprocalReq = await c.query(`SELECT id FROM friendship_requests WHERE sender_id = $1 AND receiver_id = $2 AND status = 'PENDING'`, [receiverId, sender.id]);
            if (reciprocalReq.rowCount && reciprocalReq.rowCount > 0) {
                // Auto-connect
                await c.query(`UPDATE friendship_requests SET status = 'ACCEPTED' WHERE id = $1`, [reciprocalReq.rows[0]?.id]);
                await c.query(`INSERT INTO connections (user_a, user_b)
           VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
           ON CONFLICT DO NOTHING`, [sender.id, receiverId]);
                return { status: 'already_connected' };
            }
            // Insert pending request
            await c.query(`INSERT INTO friendship_requests (sender_id, receiver_id, status)
         VALUES ($1, $2, 'PENDING')
         ON CONFLICT (sender_id, receiver_id)
         DO UPDATE SET status = 'PENDING', updated_at = now()`, [sender.id, receiverId]);
            return { status: 'sent' };
        });
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.sendFriendRequest(sender, receiverId);
        }
        throw err;
    }
}
export async function listFriendRequests(pool, user) {
    try {
        const { rows } = await pool.query(`SELECT fr.id, u.id AS sender_id, p.nickname, p.avatar_url, p.major, p.graduation_year, fr.created_at
         FROM friendship_requests fr
         JOIN users u ON u.id = fr.sender_id
         JOIN profiles p ON p.user_id = u.id
        WHERE fr.receiver_id = $1 AND fr.status = 'PENDING'
        ORDER BY fr.created_at DESC`, [user.id]);
        return rows.map((r) => ({
            id: r.id,
            sender: {
                id: r.sender_id,
                nickname: r.nickname,
                avatarUrl: r.avatar_url,
                major: r.major,
                graduationYear: r.graduation_year,
            },
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.listFriendRequests(user.id);
        }
        throw err;
    }
}
export async function respondFriendRequest(pool, user, requestId, input) {
    try {
        return await withTx(pool, async (c) => {
            const reqRes = await c.query(`SELECT id, sender_id, receiver_id FROM friendship_requests WHERE id = $1 AND receiver_id = $2 AND status = 'PENDING'`, [requestId, user.id]);
            const reqRow = reqRes.rows[0];
            if (!reqRow)
                throw notFound('Friend request not found');
            if (input.action === 'DECLINE') {
                await c.query(`UPDATE friendship_requests SET status = 'DECLINED', updated_at = now() WHERE id = $1`, [requestId]);
                return { status: 'DECLINED' };
            }
            // ACCEPT
            await c.query(`UPDATE friendship_requests SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`, [requestId]);
            await c.query(`INSERT INTO connections (user_a, user_b)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT (user_a, user_b) DO NOTHING`, [reqRow.sender_id, user.id]);
            return { status: 'ACCEPTED' };
        });
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.respondFriendRequest(user.id, requestId, input.action);
        }
        throw err;
    }
}
export async function listConnections(pool, user) {
    try {
        const { rows } = await pool.query(`SELECT c.id,
              partner.id AS partner_id,
              p.nickname,
              p.avatar_url,
              p.bio,
              p.major,
              p.graduation_year,
              p.campus_area,
              p.interests,
              c.created_at
         FROM connections c
         JOIN users partner ON partner.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
         JOIN profiles p ON p.user_id = partner.id
        WHERE c.user_a = $1 OR c.user_b = $1
        ORDER BY c.created_at DESC`, [user.id]);
        return rows.map((r) => ({
            id: r.id,
            partner: {
                id: r.partner_id,
                nickname: r.nickname,
                avatarUrl: r.avatar_url,
                bio: r.bio,
                major: r.major,
                graduationYear: r.graduation_year,
                campusArea: r.campus_area,
                interests: r.interests,
            },
            createdAt: r.created_at.toISOString(),
        }));
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.listConnections(user.id);
        }
        throw err;
    }
}
export async function removeConnection(pool, user, partnerId) {
    try {
        await pool.query(`DELETE FROM connections
        WHERE (user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid))`, [user.id, partnerId]);
        return { success: true };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.removeConnection(user.id, partnerId);
        }
        throw err;
    }
}
