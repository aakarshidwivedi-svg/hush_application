import { withTx } from '../../db/pool.js';
import { notFound } from '../../http/errors.js';
import { lockPair } from '../shared/pairLock.js';
/**
 * The single definition of "this user may see this match":
 *  - the caller is a participant,
 *  - the match is ACTIVE (unmatched conversations vanish),
 *  - the other person's account is ACTIVE (not suspended/deleted),
 *  - neither person has blocked the other.
 * Every match, message and unmatch request goes through it, so authorisation is re-checked
 * on each call and cannot be bypassed by guessing ids.
 */
const VISIBLE_MATCH_SQL = `
  FROM matches m
  JOIN users up ON up.id = CASE WHEN m.user_a = $1 THEN m.user_b ELSE m.user_a END
  JOIN profiles p ON p.user_id = up.id
  LEFT JOIN LATERAL (
    SELECT content, created_at, sender_id FROM messages
     WHERE match_id = m.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) lm ON true
 WHERE m.status = 'ACTIVE'
   AND (m.user_a = $1 OR m.user_b = $1)
   AND up.account_status = 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM blocks b
                    WHERE (b.blocker_id = $1 AND b.blocked_id = up.id)
                       OR (b.blocker_id = up.id AND b.blocked_id = $1))`;
const SELECT_COLUMNS = `
  SELECT m.id, m.created_at, up.id AS partner_id, p.nickname, p.bio, p.interests,
         COALESCE(
           (SELECT '/api/v1/profiles/photos/' || pp.id::text FROM profile_photos pp WHERE pp.user_id = up.id AND pp.is_primary LIMIT 1),
           (SELECT '/api/v1/profiles/photos/' || pp.id::text FROM profile_photos pp WHERE pp.user_id = up.id ORDER BY pp.display_order ASC LIMIT 1),
           p.avatar_url
         ) AS avatar_url,
         lm.content AS last_content, lm.created_at AS last_at, (lm.sender_id = $1) AS last_mine`;
function toView(r) {
    return {
        id: r.id,
        createdAt: r.created_at,
        partner: { id: r.partner_id, nickname: r.nickname, bio: r.bio, interests: r.interests, avatarUrl: r.avatar_url },
        lastMessage: r.last_content !== null && r.last_at !== null
            ? { preview: Array.from(r.last_content).slice(0, 80).join(''), createdAt: r.last_at, mine: r.last_mine === true }
            : null,
    };
}
export async function listMatches(db, userId) {
    const { rows } = await db.query(`${SELECT_COLUMNS} ${VISIBLE_MATCH_SQL} ORDER BY COALESCE(lm.created_at, m.created_at) DESC LIMIT 100`, [userId]);
    return rows.map(toView);
}
/** Returns the match only if `userId` may currently see it; otherwise null (callers answer 404). */
export async function findActiveMatch(db, matchId, userId) {
    const { rows } = await db.query(`${SELECT_COLUMNS} ${VISIBLE_MATCH_SQL} AND m.id = $2`, [userId, matchId]);
    return rows[0] ? toView(rows[0]) : null;
}
export async function unmatch(pool, userId, matchId) {
    const match = await findActiveMatch(pool, matchId, userId);
    if (!match)
        throw notFound('Match not found');
    await withTx(pool, async (c) => {
        await lockPair(c, userId, match.partner.id);
        const r = await c.query(`UPDATE matches SET status = 'UNMATCHED', unmatched_at = now(), unmatched_by = $2
        WHERE id = $1 AND status = 'ACTIVE'`, [matchId, userId]);
        if (r.rowCount === 0)
            throw notFound('Match not found');
    });
}
