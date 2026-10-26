import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PAIR_LOCK_SQL } from '../src/modules/shared/pairLock.js';
import { bearer, createUser, makeToken, resetDb, seedCampus, setupApp, type TestUser } from './helpers.js';

const { pool, app } = setupApp();
afterAll(() => pool.end());

let campus: string;
let a: TestUser;
let b: TestUser;

beforeEach(async () => {
  await resetDb(pool);
  campus = await seedCampus(pool, { name: 'Test University' });
  a = await createUser(pool, campus, { nickname: 'alice_a' });
  b = await createUser(pool, campus, { nickname: 'bob_b' });
});

const crush = (from: TestUser, to: string) => request(app).post(`/api/v1/crushes/${to}`).set(from.h);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
const GENERIC = { data: { status: 'sent' } };

describe('POST /crushes/:userId — access and validation', () => {
  it('requires authentication and completed onboarding', async () => {
    expect((await request(app).post(`/api/v1/crushes/${b.id}`)).status).toBe(401);
    const token = await makeToken({ sub: randomUUID(), email: 'x@uni.edu' });
    const res = await request(app).post(`/api/v1/crushes/${b.id}`).set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  it('requires an eligible, active sender', async () => {
    for (const over of [{ campusStatus: 'UNVERIFIED' as const }, { ageStatus: 'UNVERIFIED' as const }, { status: 'SUSPENDED' as const }]) {
      const u = await createUser(pool, campus, over);
      expect((await crush(u, b.id)).status, JSON.stringify(over)).toBe(403);
    }
    expect(await count('crushes')).toBe(0);
  });

  it('rejects malformed ids and self-crushes', async () => {
    expect((await crush(a, 'not-a-uuid')).status).toBe(422);
    const self = await crush(a, a.id);
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('CANNOT_CRUSH_SELF');
    expect(await count('crushes')).toBe(0);
  });

  it('ignores any sender id supplied by the client', async () => {
    const c = await createUser(pool, campus, { nickname: 'carol_c' });
    const res = await request(app).post(`/api/v1/crushes/${b.id}`).set(a.h).send({ senderId: c.id, sender_id: c.id });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT sender_id FROM crushes');
    expect(rows).toEqual([{ sender_id: a.id }]);
  });

  it('answers every invalid target identically (404)', async () => {
    const otherCampus = await seedCampus(pool, { name: 'Other U' });
    const targets = [
      randomUUID(), // does not exist
      (await createUser(pool, otherCampus)).id, // other campus
      (await createUser(pool, campus, { discoverable: false })).id,
      (await createUser(pool, campus, { status: 'SUSPENDED' })).id,
      (await createUser(pool, campus, { status: 'DELETED' })).id,
      (await createUser(pool, campus, { campusStatus: 'UNVERIFIED' })).id,
      (await createUser(pool, campus, { ageStatus: 'UNVERIFIED' })).id,
    ];
    const bodies = new Set<string>();
    for (const t of targets) {
      const res = await crush(a, t);
      expect(res.status, t).toBe(404);
      bodies.add(JSON.stringify(res.body));
    }
    expect(bodies.size).toBe(1);
    expect(await count('crushes')).toBe(0);
  });

  it('rejects crushes in either block direction without revealing the block', async () => {
    const invalid = JSON.stringify((await crush(a, randomUUID())).body);
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b.id, a.id]); // b blocked a
    const r1 = await crush(a, b.id);
    expect(r1.status).toBe(404);
    expect(JSON.stringify(r1.body)).toBe(invalid);
    await pool.query('DELETE FROM blocks');
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, b.id]); // a blocked b
    const r2 = await crush(a, b.id);
    expect(r2.status).toBe(404);
    const r3 = await crush(b, a.id); // and b → a is rejected too
    expect(r3.status).toBe(404);
    expect(await count('crushes')).toBe(0);
    expect(await count('matches')).toBe(0);
  });

  it('refuses a crush when an existing blocked state would otherwise complete a match', async () => {
    await crush(a, b.id); // a → b stored
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b.id, a.id]);
    expect((await crush(b, a.id)).status).toBe(404);
    expect(await count('matches')).toBe(0);
  });
});

describe('POST /crushes/:userId — one-sided interest stays secret', () => {
  it('returns the same generic body for one-sided and reciprocal crushes', async () => {
    const first = await crush(a, b.id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual(GENERIC);
    const second = await crush(b, a.id); // completes a match
    expect(second.status).toBe(200);
    expect(second.body).toEqual(GENERIC);
    expect(second.text).toBe(first.text);
  });

  it('gives the receiver no signal: no match, no notification, unchanged discovery', async () => {
    const before = await request(app).get('/api/v1/profiles/discover').set(b.h);
    await crush(a, b.id);
    expect(await count('matches')).toBe(0);
    expect(await count('notifications')).toBe(0);
    const after = await request(app).get('/api/v1/profiles/discover').set(b.h);
    expect(after.text).toBe(before.text);
    const inbox = await request(app).get('/api/v1/notifications').set(b.h);
    expect(inbox.body).toEqual({ data: [] });
  });

  it('exposes no endpoint to read anyone’s crush history', async () => {
    await crush(a, b.id);
    for (const [method, path] of [
      ['get', '/api/v1/crushes'],
      ['get', `/api/v1/crushes/${b.id}`],
      ['get', `/api/v1/crushes/${a.id}`],
      ['get', '/api/v1/crushes/received'],
      ['get', '/api/v1/crushes/sent'],
      ['put', `/api/v1/crushes/${b.id}`],
    ] as const) {
      const res = await request(app)[method](path).set(b.h);
      expect([404, 405], `${method} ${path}`).toContain(res.status);
      expect(res.text).not.toContain(a.id);
    }
  });

  it('keeps the response identical when repeated', async () => {
    const r1 = await crush(a, b.id);
    const r2 = await crush(a, b.id);
    expect(r2.text).toBe(r1.text);
  });
});

describe('POST /crushes/:userId — duplicates', () => {
  it('stores a repeated crush once', async () => {
    for (let i = 0; i < 3; i++) expect((await crush(a, b.id)).status).toBe(200);
    expect(await count('crushes')).toBe(1);
    expect(await count('matches')).toBe(0);
  });

  it('handles many simultaneous duplicates safely', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => crush(a, b.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await count('crushes')).toBe(1);
  });

  it('does not create anything after a match already exists', async () => {
    await crush(a, b.id);
    await crush(b, a.id);
    expect(await count('matches')).toBe(1);
    expect((await crush(a, b.id)).status).toBe(200);
    expect((await crush(b, a.id)).status).toBe(200);
    expect(await count('matches')).toBe(1);
    expect(await count('crushes')).toBe(0);
    expect(await count('notifications')).toBe(2);
  });
});

describe('reciprocal crushes create exactly one match', () => {
  it('creates one canonical match, notifies both users, and discards the crush rows', async () => {
    await crush(a, b.id);
    await crush(b, a.id);
    const { rows } = await pool.query('SELECT id, user_a, user_b, status FROM matches');
    expect(rows).toHaveLength(1);
    const [lo, hi] = [a.id, b.id].sort();
    expect(rows[0]).toMatchObject({ user_a: lo, user_b: hi, status: 'ACTIVE' });
    const notes = await pool.query('SELECT user_id, type, match_id FROM notifications ORDER BY user_id');
    expect(notes.rows).toHaveLength(2);
    expect(notes.rows.map((n) => n.user_id).sort()).toEqual([lo, hi]);
    expect(notes.rows.every((n) => n.type === 'MATCH' && n.match_id === rows[0].id)).toBe(true);
    expect(await count('crushes')).toBe(0);
  });

  it('works regardless of who crushes first', async () => {
    await crush(b, a.id);
    await crush(a, b.id);
    expect(await count('matches')).toBe(1);
  });

  it('delivers each notification only to its own recipient', async () => {
    await crush(a, b.id);
    await crush(b, a.id);
    const c = await createUser(pool, campus, { nickname: 'carol_c' });
    const mine = await request(app).get('/api/v1/notifications').set(a.h);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ type: 'MATCH' });
    expect(Object.keys(mine.body.data[0]).sort()).toEqual(['createdAt', 'id', 'matchId', 'type']);
    expect((await request(app).get('/api/v1/notifications').set(c.h)).body.data).toEqual([]);
    const read = await request(app).post('/api/v1/notifications/read').set(a.h);
    expect(read.body.data).toEqual({ marked: 1 });
    expect((await request(app).get('/api/v1/notifications').set(a.h)).body.data).toEqual([]);
    expect((await request(app).get('/api/v1/notifications').set(b.h)).body.data).toHaveLength(1); // b's is untouched
  });

  it('does not notify about a match that failed to commit', async () => {
    // Force the transaction to fail after the match insert by making notifications reject the insert.
    await pool.query(`ALTER TABLE notifications ADD CONSTRAINT force_fail CHECK (false) NOT VALID`);
    try {
      await crush(a, b.id);
      const res = await crush(b, a.id);
      expect(res.status).toBe(500);
      expect(await count('matches')).toBe(0); // rolled back with the notification
      expect(await count('notifications')).toBe(0);
      expect(await count('crushes')).toBe(1); // a→b committed earlier; b→a rolled back
    } finally {
      await pool.query('ALTER TABLE notifications DROP CONSTRAINT force_fail');
    }
    // After recovery the reciprocal crush produces the match normally.
    expect((await crush(b, a.id)).status).toBe(200);
    expect(await count('matches')).toBe(1);
    expect(await count('notifications')).toBe(2);
  });

  it('never re-matches a pair after an unmatch', async () => {
    await crush(a, b.id);
    await crush(b, a.id);
    await pool.query(`UPDATE matches SET status = 'UNMATCHED', unmatched_at = now(), unmatched_by = $1`, [a.id]);
    expect((await crush(a, b.id)).body).toEqual(GENERIC); // generic success…
    expect((await crush(b, a.id)).body).toEqual(GENERIC);
    expect(await count('matches')).toBe(1); // …but no new match
    expect(await count('crushes')).toBe(0); // and nothing stored
    expect((await pool.query('SELECT status FROM matches')).rows[0].status).toBe('UNMATCHED');
  });
});

describe('concurrency (real PostgreSQL)', () => {
  it('simultaneous reciprocal crushes create exactly one match — repeated 25 times', async () => {
    const pairs = await Promise.all(
      Array.from({ length: 25 }, async (_, i) => [
        await createUser(pool, campus, { nickname: `pa_${i}` }),
        await createUser(pool, campus, { nickname: `pb_${i}` }),
      ] as const),
    );
    // Fire both directions of all 25 pairs at once (50 concurrent requests).
    const responses = await Promise.all(pairs.flatMap(([x, y]) => [crush(x, y.id), crush(y, x.id)]));
    expect(responses.every((r) => r.status === 200 && r.text === JSON.stringify(GENERIC))).toBe(true);

    const matches = await pool.query('SELECT user_a, user_b FROM matches');
    expect(matches.rowCount).toBe(25);
    const keys = new Set(matches.rows.map((m) => `${m.user_a}:${m.user_b}`));
    expect(keys.size).toBe(25); // no duplicates
    for (const m of matches.rows) expect(m.user_a < m.user_b).toBe(true);
    expect(await count('notifications')).toBe(50); // exactly two per match
    expect(await count('crushes')).toBe(0);
  });

  it('an all-to-all mesh of simultaneous crushes yields exactly one match per pair', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => createUser(pool, campus, { nickname: `mesh_${i}` })));
    const reqs = users.flatMap((x) => users.filter((y) => y.id !== x.id).map((y) => crush(x, y.id)));
    expect(reqs).toHaveLength(30);
    const responses = await Promise.all(reqs);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await count('matches')).toBe(15); // C(6,2) — and the unique constraint would have failed any duplicate
    expect(await count('notifications')).toBe(30);
    expect(await count('crushes')).toBe(0);
  });

  it('simultaneous duplicate + reciprocal storms never produce a duplicate match', async () => {
    const reqs = [
      ...Array.from({ length: 8 }, () => crush(a, b.id)),
      ...Array.from({ length: 8 }, () => crush(b, a.id)),
    ];
    const responses = await Promise.all(reqs);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await count('matches')).toBe(1);
    expect(await count('notifications')).toBe(2);
  });

  it('takes the pair lock: a crush waits for a concurrent transaction on the same pair', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(PAIR_LOCK_SQL, [a.id, b.id]);
      let done = false;
      const pending = crush(a, b.id).then((r) => {
        done = true;
        return r;
      });
      await sleep(400);
      expect(done).toBe(false); // blocked on the advisory lock
      await holder.query('COMMIT');
      expect((await pending).status).toBe(200);
    } finally {
      holder.release();
    }
  });

  it('sees an opposite crush that is still uncommitted when the request arrives (the lost-match race)', async () => {
    // Simulates B's in-flight transaction: it holds the pair lock and has inserted B→A but not committed.
    const inFlight = await pool.connect();
    try {
      await inFlight.query('BEGIN');
      await inFlight.query(PAIR_LOCK_SQL, [a.id, b.id]);
      await inFlight.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $2)', [b.id, a.id]);
      const pending = crush(a, b.id).then((r) => r); // .then() sends the request now (supertest is lazy)
      await sleep(300);
      await inFlight.query('COMMIT');
      expect((await pending).status).toBe(200);
    } finally {
      inFlight.release();
    }
    expect(await count('matches')).toBe(1);
    expect(await count('notifications')).toBe(2);
  });

  it('does not interfere across different pairs', async () => {
    const c = await createUser(pool, campus, { nickname: 'carol_c' });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(PAIR_LOCK_SQL, [a.id, b.id]);
      const res = await crush(a, c.id); // different pair → must not block
      expect(res.status).toBe(200);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
  });
});

describe('DELETE /crushes/:userId', () => {
  it('withdraws the caller’s own crush so a later reciprocal crush does not match', async () => {
    await crush(a, b.id);
    const del = await request(app).delete(`/api/v1/crushes/${b.id}`).set(a.h);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ data: { status: 'withdrawn' } });
    expect(await count('crushes')).toBe(0);
    await crush(b, a.id);
    expect(await count('matches')).toBe(0);
    expect(await count('crushes')).toBe(1);
  });

  it('responds identically whether or not a crush existed, and never touches others’ crushes', async () => {
    await crush(b, a.id); // b → a exists; a has not crushed b
    const del = await request(app).delete(`/api/v1/crushes/${b.id}`).set(a.h);
    expect(del.body).toEqual({ data: { status: 'withdrawn' } });
    expect((await request(app).delete(`/api/v1/crushes/${randomUUID()}`).set(a.h)).body).toEqual(del.body);
    expect(await count('crushes')).toBe(1); // b's crush is untouched
  });

  it('requires authentication, eligibility and a valid id', async () => {
    expect((await request(app).delete(`/api/v1/crushes/${b.id}`)).status).toBe(401);
    expect((await request(app).delete('/api/v1/crushes/xyz').set(a.h)).status).toBe(422);
    const u = await createUser(pool, campus, { status: 'SUSPENDED' });
    expect((await request(app).delete(`/api/v1/crushes/${b.id}`).set(u.h)).status).toBe(403);
  });

  it('is safe to race against a reciprocal crush', async () => {
    for (let i = 0; i < 10; i++) {
      const x = await createUser(pool, campus, { nickname: `rx_${i}` });
      const y = await createUser(pool, campus, { nickname: `ry_${i}` });
      await crush(x, y.id);
      const [, del] = await Promise.all([crush(y, x.id), request(app).delete(`/api/v1/crushes/${y.id}`).set(x.h)]);
      expect(del.status).toBe(200);
      // Either order is valid, but the state must be consistent: a match (and no crushes) or no match.
      const m = await pool.query('SELECT count(*)::int AS n FROM matches WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)', [x.id, y.id]);
      const stray = await pool.query(
        'SELECT count(*)::int AS n FROM crushes WHERE sender_id IN ($1,$2) AND receiver_id IN ($1,$2)',
        [x.id, y.id],
      );
      expect(m.rows[0].n).toBeLessThanOrEqual(1);
      if (m.rows[0].n === 1) expect(stray.rows[0].n).toBe(0);
    }
  });
});

describe('rate limiting', () => {
  it('limits crush volume per user', async () => {
    const limited = setupApp({ crush: { windowMs: 60_000, max: 3 } });
    try {
      const targets = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(pool, campus, { nickname: `rl_${i}` })));
      const statuses: number[] = [];
      for (const t of targets) statuses.push((await request(limited.app).post(`/api/v1/crushes/${t.id}`).set(a.h)).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      expect((await request(limited.app).post(`/api/v1/crushes/${targets[0]!.id}`).set(b.h)).status).toBe(200); // other users unaffected
    } finally {
      await limited.pool.end();
    }
  });
});
