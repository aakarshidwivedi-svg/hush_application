import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { createUser, resetDb, seedCampus, setupApp } from './helpers.js';

const { pool } = setupApp();
afterAll(() => pool.end());

async function expectPgError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe('database constraints (source of truth, independent of the API)', () => {
  let campus: string;
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDb(pool);
    campus = await seedCampus(pool);
    a = await createUser(pool, campus);
    b = await createUser(pool, campus);
  });

  it('applies migrations idempotently', async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });

  it('rejects self-crushes', async () => {
    await expectPgError(pool.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $1)', [a.id]), '23514');
  });

  it('rejects duplicate crushes', async () => {
    await pool.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $2)', [a.id, b.id]);
    await expectPgError(pool.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $2)', [a.id, b.id]), '23505');
  });

  it('rejects self-matches, non-canonical order and duplicate matches', async () => {
    await expectPgError(pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $1)', [a.id]), '23514');
    const [lo, hi] = [a.id, b.id].sort();
    await expectPgError(pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $2)', [hi, lo]), '23514');
    await pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $2)', [lo, hi]);
    await expectPgError(pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $2)', [lo, hi]), '23505');
  });

  it('rejects self-blocks and duplicate blocks', async () => {
    await expectPgError(pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $1)', [a.id]), '23514');
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, b.id]);
    await expectPgError(pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, b.id]), '23505');
  });

  it('rejects empty and oversized messages', async () => {
    const [lo, hi] = [a.id, b.id].sort();
    const m = await pool.query<{ id: string }>('INSERT INTO matches (user_a, user_b) VALUES ($1, $2) RETURNING id', [lo, hi]);
    const id = m.rows[0]!.id;
    await expectPgError(pool.query('INSERT INTO messages (match_id, sender_id, content) VALUES ($1, $2, $3)', [id, a.id, '']), '23514');
    await expectPgError(
      pool.query('INSERT INTO messages (match_id, sender_id, content) VALUES ($1, $2, $3)', [id, a.id, 'x'.repeat(1001)]),
      '23514',
    );
  });

  it('enforces unique nicknames case-insensitively and nickname format', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO profiles (user_id, nickname, nickname_key) VALUES ((SELECT id FROM users WHERE id <> $1 LIMIT 1), $2, $3)`,
        [a.id, a.nickname.toUpperCase(), a.nickname.toLowerCase()],
      ),
      '23505',
    );
    await expectPgError(pool.query('UPDATE profiles SET nickname = $2, nickname_key = $2 WHERE user_id = $1', [a.id, 'a b!']), '23514');
  });

  it('enables row level security with no policies on every table', async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname <> 'schema_migrations'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
    const policies = await pool.query('SELECT 1 FROM pg_policies WHERE schemaname = $1', ['public']);
    expect(policies.rowCount).toBe(0);
  });
});
