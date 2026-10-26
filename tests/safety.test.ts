import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeDeletedAccounts } from '../src/modules/account/service.js';
import { bearer, createUser, makeToken, MODERATOR_SUB, resetDb, seedCampus, setupApp, type TestUser } from './helpers.js';

const { pool, app } = setupApp();
afterAll(() => pool.end());

let campus: string;
let a: TestUser;
let b: TestUser;
let c: TestUser;

beforeEach(async () => {
  await resetDb(pool);
  campus = await seedCampus(pool, { name: 'Test University' });
  a = await createUser(pool, campus, { nickname: 'alice_a' });
  b = await createUser(pool, campus, { nickname: 'bob_b' });
  c = await createUser(pool, campus, { nickname: 'carol_c' });
});

const crush = (from: TestUser, to: string) => request(app).post(`/api/v1/crushes/${to}`).set(from.h);
const block = (from: TestUser, to: string) => request(app).post(`/api/v1/users/${to}/block`).set(from.h);
const unblock = (from: TestUser, to: string) => request(app).delete(`/api/v1/users/${to}/block`).set(from.h);
const report = (from: TestUser, body: unknown) => request(app).post('/api/v1/reports').set(from.h).send(body as object);
const send = (u: TestUser, matchId: string, content: string) =>
  request(app).post(`/api/v1/matches/${matchId}/messages`).set(u.h).send({ content });
const count = async (table: string, where = 'true') =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n as number;

async function makeMatch(x: TestUser, y: TestUser): Promise<string> {
  await crush(x, y.id);
  await crush(y, x.id);
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM matches WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)',
    [x.id, y.id],
  );
  return rows[0]!.id;
}

async function moderatorHeaders() {
  return bearer(await makeToken({ sub: MODERATOR_SUB, email: 'mod@uni.edu' }));
}

describe('blocking', () => {
  it('requires authentication and a valid target', async () => {
    expect((await request(app).post(`/api/v1/users/${b.id}/block`)).status).toBe(401);
    expect((await block(a, 'not-a-uuid')).status).toBe(422);
    const self = await block(a, a.id);
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('CANNOT_BLOCK_SELF');
  });

  it('answers identically for unknown ids, other campuses and deleted accounts (no id probing)', async () => {
    const otherCampus = await seedCampus(pool, { name: 'Other U' });
    const outsider = await createUser(pool, otherCampus);
    const gone = await createUser(pool, campus, { status: 'DELETED' }).catch(() => null);
    const bodies = [(await block(a, randomUUID())).body, (await block(a, outsider.id)).body];
    expect(bodies[0]).toEqual(bodies[1]);
    expect((await block(a, outsider.id)).status).toBe(404);
    expect(gone === null || (await block(a, gone.id)).status === 404).toBe(true);
    expect(await count('blocks')).toBe(0);
  });

  it('is idempotent and prevents duplicate block rows', async () => {
    expect((await block(a, b.id)).status).toBe(200);
    expect((await block(a, b.id)).status).toBe(200);
    expect(await count('blocks')).toBe(1);
  });

  it('ends an active match, hides the chat from both sides and stops messages', async () => {
    const matchId = await makeMatch(a, b);
    expect((await send(a, matchId, 'hi')).status).toBe(201);
    expect((await block(a, b.id)).status).toBe(200);

    expect((await pool.query('SELECT status, unmatched_by FROM matches WHERE id = $1', [matchId])).rows[0]).toEqual({
      status: 'UNMATCHED',
      unmatched_by: a.id,
    });
    for (const u of [a, b]) {
      expect((await request(app).get('/api/v1/matches').set(u.h)).body.data).toEqual([]);
      expect((await request(app).get(`/api/v1/matches/${matchId}`).set(u.h)).status).toBe(404);
      expect((await request(app).get(`/api/v1/matches/${matchId}/messages`).set(u.h)).status).toBe(404);
      expect((await send(u, matchId, 'still there?')).status).toBe(404);
    }
  });

  it('blocked people cannot crush the blocker, and the blocker cannot crush them (both directions)', async () => {
    await block(a, b.id);
    expect((await crush(b, a.id)).status).toBe(404);
    expect((await crush(a, b.id)).status).toBe(404);
    expect(await count('crushes')).toBe(0);
  });

  it('removes each other from discovery in both directions', async () => {
    await block(a, b.id);
    const ids = async (u: TestUser) => (await request(app).get('/api/v1/profiles/discover').set(u.h)).body.data.map((p: { id: string }) => p.id);
    expect(await ids(a)).not.toContain(b.id);
    expect(await ids(b)).not.toContain(a.id);
    expect(await ids(a)).toContain(c.id);
  });

  it('wipes pending crushes in both directions so no one-sided interest survives', async () => {
    await crush(a, b.id);
    await crush(c, a.id);
    expect(await count('crushes')).toBe(2);
    await block(a, b.id);
    await block(a, c.id);
    expect(await count('crushes')).toBe(0);
  });

  it('unblocking removes only the caller\'s block and does not revive the match or old crushes', async () => {
    const matchId = await makeMatch(a, b);
    await block(a, b.id);
    await block(b, a.id);
    expect((await unblock(a, b.id)).status).toBe(200);
    expect(await count('blocks')).toBe(1); // b's block of a remains
    expect((await request(app).get(`/api/v1/matches/${matchId}`).set(a.h)).status).toBe(404);
    // b's block still stops contact either way
    expect((await crush(a, b.id)).status).toBe(404);
    // after both unblock, the ended match stays ended: crushes become a silent no-op
    await unblock(b, a.id);
    expect((await crush(a, b.id)).status).toBe(200);
    expect(await count('crushes')).toBe(0);
  });

  it('GET /blocks lists only the caller\'s own blocks and never who blocked them', async () => {
    await block(a, b.id);
    await block(c, a.id);
    const mine = await request(app).get('/api/v1/blocks').set(a.h);
    expect(mine.body.data.map((x: { nickname: string }) => x.nickname)).toEqual(['bob_b']);
    expect(Object.keys(mine.body.data[0]).sort()).toEqual(['blockedAt', 'id', 'nickname']);
    expect((await request(app).get('/api/v1/blocks').set(b.h)).body.data).toEqual([]);
    expect(JSON.stringify(mine.body)).not.toContain('carol_c');
  });

  it('a concurrent block and message never leaves a message in an ended conversation', async () => {
    const matchId = await makeMatch(a, b);
    const results = await Promise.all([block(a, b.id), ...Array.from({ length: 8 }, (_, i) => send(b, matchId, `m${i}`))]);
    expect(results[0]!.status).toBe(200);
    const stored = await count('messages', `match_id = '${matchId}'`);
    const accepted = results.slice(1).filter((r) => r.status === 201).length;
    expect(stored).toBe(accepted);
    // once the block committed, nothing more gets through
    expect((await send(b, matchId, 'late')).status).toBe(404);
  });
});

describe('unmatching', () => {
  it('prevents new messages from either side and removes the match from lists', async () => {
    const matchId = await makeMatch(a, b);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(a.h)).status).toBe(200);
    expect((await send(a, matchId, 'x')).status).toBe(404);
    expect((await send(b, matchId, 'x')).status).toBe(404);
    expect((await request(app).get('/api/v1/matches').set(b.h)).body.data).toEqual([]);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(c.h)).status).toBe(404);
  });
});

describe('POST /reports', () => {
  const valid = () => ({ targetId: b.id, reason: 'HARASSMENT', details: 'rude messages' });

  it('requires authentication and strictly validates the body', async () => {
    expect((await request(app).post('/api/v1/reports').send(valid())).status).toBe(401);
    expect((await report(a, { ...valid(), reason: 'NOPE' })).status).toBe(422);
    expect((await report(a, { ...valid(), targetId: 'x' })).status).toBe(422);
    expect((await report(a, { ...valid(), details: 'x'.repeat(1001) })).status).toBe(422);
    expect((await report(a, { ...valid(), status: 'ACTIONED' })).status).toBe(422); // cannot self-resolve
    expect((await report(a, { ...valid(), reporterId: c.id })).status).toBe(422); // reporter comes from the token
    expect(await count('reports')).toBe(0);
  });

  it('rejects self-reports', async () => {
    const res = await report(a, { targetId: a.id, reason: 'SPAM' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANNOT_REPORT_SELF');
  });

  it('stores the report against the token identity', async () => {
    const res = await report(a, valid());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { status: 'received' } });
    const { rows } = await pool.query('SELECT reporter_id, target_id, reason, status FROM reports');
    expect(rows).toEqual([{ reporter_id: a.id, target_id: b.id, reason: 'HARASSMENT', status: 'OPEN' }]);
  });

  it('gives the same acknowledgement for unknown targets and does not store anything', async () => {
    const known = await report(a, valid());
    const unknown = await report(a, { targetId: randomUUID(), reason: 'HARASSMENT' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(await count('reports')).toBe(1);
  });

  it('merges repeat and concurrent reports into one live report per reporter+target', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => report(a, valid())));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(await count('reports')).toBe(1);
    await report(c, valid()); // a different reporter is still recorded
    expect(await count('reports')).toBe(2);
  });

  it('is rate limited', async () => {
    const limited = setupApp({ report: { windowMs: 60_000, max: 2 } });
    try {
      const post = () => request(limited.app).post('/api/v1/reports').set(a.h).send(valid());
      expect([(await post()).status, (await post()).status]).toEqual([201, 201]);
      const third = await post();
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.pool.end();
    }
  });
});

describe('moderation access control', () => {
  it('hides moderation routes from everyone who is not a configured moderator', async () => {
    await report(a, { targetId: b.id, reason: 'SPAM' });
    const rid = (await pool.query('SELECT id FROM reports')).rows[0].id as string;
    for (const u of [a, b, c]) {
      expect((await request(app).get('/api/v1/moderation/reports').set(u.h)).status).toBe(404);
      expect((await request(app).patch(`/api/v1/moderation/reports/${rid}`).set(u.h).send({ status: 'DISMISSED' })).status).toBe(404);
      expect((await request(app).post(`/api/v1/moderation/users/${b.id}/suspend`).set(u.h)).status).toBe(404);
    }
    expect((await request(app).get('/api/v1/moderation/reports')).status).toBe(401);
    // a forged role claim in the token grants nothing
    const forged = bearer(await makeToken({ sub: a.sub, role: 'authenticated' }));
    expect((await request(app).get('/api/v1/moderation/reports').set(forged)).status).toBe(404);
    // and nothing changed
    expect((await pool.query('SELECT status FROM reports WHERE id = $1', [rid])).rows[0].status).toBe('OPEN');
    expect((await pool.query('SELECT account_status FROM users WHERE id = $1', [b.id])).rows[0].account_status).toBe('ACTIVE');
  });

  it('lets a moderator list, filter and resolve reports', async () => {
    await report(a, { targetId: b.id, reason: 'HARASSMENT', details: 'details here' });
    await report(c, { targetId: b.id, reason: 'SPAM' });
    const mod = await moderatorHeaders();
    const all = await request(app).get('/api/v1/moderation/reports').set(mod);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0]).toMatchObject({
      reason: 'HARASSMENT',
      details: 'details here',
      status: 'OPEN',
      reporter: { id: a.id, nickname: 'alice_a' },
      target: { id: b.id, nickname: 'bob_b', accountStatus: 'ACTIVE' },
    });
    const rid = all.body.data[0].id as string;
    const patched = await request(app).patch(`/api/v1/moderation/reports/${rid}`).set(mod).send({ status: 'ACTIONED', note: 'warned user' });
    expect(patched.status).toBe(200);
    expect((await pool.query('SELECT status, reviewed_by, resolution_note FROM reports WHERE id = $1', [rid])).rows[0]).toEqual({
      status: 'ACTIONED',
      reviewed_by: MODERATOR_SUB,
      resolution_note: 'warned user',
    });
    const open = await request(app).get('/api/v1/moderation/reports?status=OPEN').set(mod);
    expect(open.body.data).toHaveLength(1);
    expect((await request(app).patch(`/api/v1/moderation/reports/${randomUUID()}`).set(mod).send({ status: 'DISMISSED' })).status).toBe(404);
    expect((await request(app).patch(`/api/v1/moderation/reports/${rid}`).set(mod).send({ status: 'OPEN' })).status).toBe(422);
  });

  it('suspension removes a user from discovery, matches and crush targets; reinstate restores', async () => {
    const matchId = await makeMatch(a, b);
    const mod = await moderatorHeaders();
    expect((await request(app).post(`/api/v1/moderation/users/${b.id}/suspend`).set(mod)).status).toBe(200);

    expect((await request(app).get('/api/v1/profiles/discover').set(c.h)).body.data.map((p: { id: string }) => p.id)).not.toContain(b.id);
    expect((await crush(c, b.id)).status).toBe(404);
    expect((await request(app).get('/api/v1/matches').set(a.h)).body.data).toEqual([]);
    expect((await send(a, matchId, 'hello?')).status).toBe(404);
    const suspended = await request(app).get('/api/v1/matches').set(b.h);
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await request(app).patch('/api/v1/profiles/me').set(b.h).send({ bio: 'x' })).status).toBe(403);

    await request(app).post(`/api/v1/moderation/users/${b.id}/reinstate`).set(mod);
    expect((await request(app).get('/api/v1/matches').set(a.h)).body.data).toHaveLength(1);
  });

  it('verify-age upgrades a user on a campus that requires verified age', async () => {
    const strict = await seedCampus(pool, { name: 'Strict U', requireVerifiedAge: true });
    const u = await createUser(pool, strict, { ageStatus: 'SELF_ATTESTED' });
    expect((await request(app).get('/api/v1/matches').set(u.h)).body.error.code).toBe('NOT_ELIGIBLE');
    await request(app).post(`/api/v1/moderation/users/${u.id}/verify-age`).set(await moderatorHeaders());
    expect((await request(app).get('/api/v1/matches').set(u.h)).status).toBe(200);
  });
});

describe('DELETE /account', () => {
  const del = (u: TestUser, body: unknown = { confirm: 'DELETE' }) => request(app).delete('/api/v1/account').set(u.h).send(body as object);

  it('requires authentication and explicit confirmation', async () => {
    expect((await request(app).delete('/api/v1/account').send({ confirm: 'DELETE' })).status).toBe(401);
    expect((await del(a, {})).status).toBe(422);
    expect((await del(a, { confirm: 'yes' })).status).toBe(422);
    expect((await pool.query('SELECT account_status FROM users WHERE id = $1', [a.id])).rows[0].account_status).toBe('ACTIVE');
  });

  it('erases personal data and conversations but leaves a bare tombstone', async () => {
    const matchId = await makeMatch(a, b);
    await send(a, matchId, 'secret words');
    await send(b, matchId, 'reply');
    await crush(a, c.id);
    await crush(c, a.id).catch(() => null);
    await block(a, c.id);
    await report(b, { targetId: a.id, reason: 'SPAM' });

    expect((await del(a)).status).toBe(200);

    expect(await count('profiles', `user_id = '${a.id}'`)).toBe(0);
    expect(await count('messages')).toBe(0);
    expect(await count('crushes', `sender_id = '${a.id}' OR receiver_id = '${a.id}'`)).toBe(0);
    expect(await count('notifications', `user_id = '${a.id}'`)).toBe(0);
    expect(await count('blocks', `blocker_id = '${a.id}' OR blocked_id = '${a.id}'`)).toBe(0);
    expect((await pool.query('SELECT status FROM matches WHERE id = $1', [matchId])).rows[0].status).toBe('UNMATCHED');
    const t = (await pool.query('SELECT account_status, deleted_at FROM users WHERE id = $1', [a.id])).rows[0];
    expect(t.account_status).toBe('DELETED');
    expect(t.deleted_at).not.toBeNull();
    expect(await count('reports')).toBe(1); // safety record survives

    // the deleted person vanishes for everyone else
    expect((await request(app).get('/api/v1/matches').set(b.h)).body.data).toEqual([]);
    expect((await request(app).get('/api/v1/profiles/discover').set(c.h)).body.data.map((p: { id: string }) => p.id)).not.toContain(a.id);
    expect((await crush(c, a.id)).status).toBe(404);
  });

  it('invalidates the deleted account\'s token, frees the nickname and is not repeatable', async () => {
    expect((await del(a)).status).toBe(200);
    expect((await request(app).get('/api/v1/profiles/me').set(a.h)).status).toBe(401);
    expect((await del(a)).status).toBe(401);
    const reuse = await createUser(pool, campus, { nickname: 'alice_a' }); // nickname is free again
    expect(reuse.id).not.toBe(a.id);
  });

  it('lets a suspended account delete itself', async () => {
    await pool.query(`UPDATE users SET account_status = 'SUSPENDED' WHERE id = $1`, [a.id]);
    expect((await del(a)).status).toBe(200);
    expect(await count('profiles', `user_id = '${a.id}'`)).toBe(0);
  });

  it('is safe against a concurrent crush on the deleted user (no active match with a deleted partner)', async () => {
    await crush(a, b.id);
    await Promise.all([del(a), crush(b, a.id)]);
    expect(await count('matches', `status = 'ACTIVE' AND (user_a = '${a.id}' OR user_b = '${a.id}')`)).toBe(0);
    expect((await request(app).get('/api/v1/matches').set(b.h)).body.data).toEqual([]);
  });
});

describe('retention purge', () => {
  const backdate = (id: string, days: number) =>
    pool.query(`UPDATE users SET deleted_at = now() - make_interval(days => $2) WHERE id = $1`, [id, days]);

  it('keeps recent tombstones, and removes old ones only when no live report references them', async () => {
    const old1 = await createUser(pool, campus);
    const old2 = await createUser(pool, campus);
    const recent = await createUser(pool, campus);
    for (const u of [old1, old2, recent]) await request(app).delete('/api/v1/account').set(u.h).send({ confirm: 'DELETE' });
    await backdate(old1.id, 120);
    await backdate(old2.id, 120);
    await pool.query(`INSERT INTO reports (reporter_id, target_id, reason) VALUES ($1, $2, 'SPAM')`, [a.id, old2.id]); // live
    const first = await purgeDeletedAccounts(pool, 90);
    expect(first.users).toBe(1); // only old1
    expect(await count('users', `id = '${old1.id}'`)).toBe(0);
    expect(await count('users', `id = '${old2.id}'`)).toBe(1);
    expect(await count('users', `id = '${recent.id}'`)).toBe(1);

    // once the report is closed and past retention, the tombstone can go too
    await pool.query(`UPDATE reports SET status = 'DISMISSED', reviewed_at = now() - interval '100 days'`);
    const second = await purgeDeletedAccounts(pool, 90);
    expect(second).toEqual({ reports: 1, users: 1 });
    expect(await count('users', `id = '${old2.id}'`)).toBe(0);
    expect(await count('users', `id = '${recent.id}'`)).toBe(1);
  });

  it('never touches active accounts', async () => {
    await purgeDeletedAccounts(pool, 0);
    expect(await count('users')).toBe(3);
  });
});
