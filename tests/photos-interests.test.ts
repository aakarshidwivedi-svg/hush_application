import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { createUser, resetDb, seedCampus, setupApp } from './helpers.js';

const { pool } = setupApp();
afterAll(() => pool.end());

async function expectPgError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe('Photos & Canonical Interests (Database & API Integration Tests)', () => {
  let campus: string;
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDb(pool);
    campus = await seedCampus(pool);
    a = await createUser(pool, campus);
    b = await createUser(pool, campus);
  });

  it('applies migrations including 0005 idempotently', async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });

  it('enforces maximum 1 primary photo per user in the database', async () => {
    await pool.query(
      `INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
       VALUES ($1, 'photos/test1.jpg', 0, true)`,
      [a.id],
    );

    // Second primary photo for same user must be rejected by partial unique index (23505)
    await expectPgError(
      pool.query(
        `INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
         VALUES ($1, 'photos/test2.jpg', 1, true)`,
        [a.id],
      ),
      '23505',
    );
  });

  it('enforces display_order range constraint (0 to 5)', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
         VALUES ($1, 'photos/test.jpg', 6, false)`,
        [a.id],
      ),
      '23514', // check constraint violation
    );

    await expectPgError(
      pool.query(
        `INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
         VALUES ($1, 'photos/test.jpg', -1, false)`,
        [a.id],
      ),
      '23514',
    );
  });

  it('cascades deletion of profile_photos and user_interests when user is deleted', async () => {
    const photo = await pool.query<{ id: string }>(
      `INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
       VALUES ($1, 'photos/test.jpg', 0, true) RETURNING id`,
      [a.id],
    );

    const interest = await pool.query<{ id: string }>(
      `SELECT id FROM interests LIMIT 1`,
    );
    const interestId = interest.rows[0]?.id;

    if (interestId) {
      await pool.query(
        `INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)`,
        [a.id, interestId],
      );
    }

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [a.id]);

    const remainingPhotos = await pool.query(
      'SELECT 1 FROM profile_photos WHERE id = $1',
      [photo.rows[0]?.id],
    );
    expect(remainingPhotos.rowCount).toBe(0);

    if (interestId) {
      const remainingInterests = await pool.query(
        'SELECT 1 FROM user_interests WHERE user_id = $1',
        [a.id],
      );
      expect(remainingInterests.rowCount).toBe(0);
    }
  });

  it('rejects duplicate user_interests entries for the same user and interest', async () => {
    const interest = await pool.query<{ id: string }>('SELECT id FROM interests LIMIT 1');
    const interestId = interest.rows[0]?.id;
    if (!interestId) return;

    await pool.query('INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)', [a.id, interestId]);
    await expectPgError(
      pool.query('INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)', [a.id, interestId]),
      '23505',
    );
  });
});
