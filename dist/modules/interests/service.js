import { withTx } from '../../db/pool.js';
import { validation } from '../../http/errors.js';
export async function listActiveInterests(db) {
    const { rows } = await db.query(`SELECT id, name, category
       FROM interests
      WHERE is_active = true
      ORDER BY category ASC, name ASC`);
    return rows;
}
export async function getUserInterests(db, userId) {
    const { rows } = await db.query(`SELECT i.id, i.name, i.category
       FROM user_interests ui
       JOIN interests i ON i.id = ui.interest_id
      WHERE ui.user_id = $1 AND i.is_active = true
      ORDER BY i.category ASC, i.name ASC`, [userId]);
    return rows;
}
export async function setUserInterests(pool, userId, interestIds) {
    // Validate count (3 to 10)
    if (interestIds.length < 3 || interestIds.length > 10) {
        throw validation(`Please select between 3 and 10 interests (got ${interestIds.length})`);
    }
    // Check for duplicates
    const uniqueIds = Array.from(new Set(interestIds));
    if (uniqueIds.length !== interestIds.length) {
        throw validation('Duplicate interest IDs are not allowed');
    }
    // Verify all interest IDs exist and are active
    const { rows: validRows } = await pool.query(`SELECT id, name, category FROM interests WHERE id = ANY($1) AND is_active = true`, [uniqueIds]);
    if (validRows.length !== uniqueIds.length) {
        const validSet = new Set(validRows.map((r) => r.id));
        const invalidIds = uniqueIds.filter((id) => !validSet.has(id));
        throw validation(`One or more selected interests are invalid or inactive: ${invalidIds.join(', ')}`);
    }
    return await withTx(pool, async (c) => {
        // Replace user interests
        await c.query('DELETE FROM user_interests WHERE user_id = $1', [userId]);
        for (const interestId of uniqueIds) {
            await c.query('INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)', [userId, interestId]);
        }
        // Keep profiles.interests string array synchronized for backwards compatibility
        const names = validRows.map((r) => r.name);
        await c.query('UPDATE profiles SET interests = $1, updated_at = now() WHERE user_id = $2', [names, userId]);
        return validRows;
    });
}
