import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, resetDb, seedCampus, setupApp, type TestUser } from './helpers.js';

const { pool, app } = setupApp();
afterAll(() => pool.end());

let campus: string;
let a: TestUser;
let b: TestUser;
let c: TestUser; // outsider

beforeEach(async () => {
  await resetDb(pool);
  campus = await seedCampus(pool, { name: 'Test University' });
  a = await createUser(pool, campus, { nickname: 'alice_a', bio: 'alice bio', interests: ['art'] });
  b = await createUser(pool, campus, { nickname: 'bob_b', bio: 'bob bio', interests: ['film'] });
  c = await createUser(pool, campus, { nickname: 'carol_c' });
});

const crush = (from: TestUser, to: string) => request(app).post(`/api/v1/crushes/${to}`).set(from.h);
async function makeMatch(x: TestUser, y: TestUser): Promise<string> {
  await crush(x, y.id);
  await crush(y, x.id);
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM matches WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)',
    [x.id, y.id],
  );
  return rows[0]!.id;
}
const get = (u: TestUser, path: string) => request(app).get(`/api/v1${path}`).set(u.h);
const send = (u: TestUser, matchId: string, body: unknown) => request(app).post(`/api/v1/matches/${matchId}/messages`).set(u.h).send(body as object);
const count = async (table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Match not found' } };

describe('GET /matches', () => {
  it('requires authentication, onboarding and eligibility', async () => {
    expect((await request(app).get('/api/v1/matches')).status).toBe(401);
    const u = await createUser(pool, campus, { campusStatus: 'UNVERIFIED' });
    expect((await get(u, '/matches')).status).toBe(403);
    const s = await createUser(pool, campus, { status: 'SUSPENDED' });
    expect((await get(s, '/matches')).body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('lists an active match for both participants with approved profile info only', async () => {
    const matchId = await makeMatch(a, b);
    const ra = await get(a, '/matches');
    expect(ra.status).toBe(200);
    expect(ra.body.data).toHaveLength(1);
    const item = ra.body.data[0];
    expect(item).toMatchObject({
      id: matchId,
      partner: { id: b.id, nickname: 'bob_b', bio: 'bob bio', interests: ['film'], avatarUrl: null },
      lastMessage: null,
    });
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'lastMessage', 'partner']);
    expect(Object.keys(item.partner).sort()).toEqual(['avatarUrl', 'bio', 'id', 'interests', 'nickname']);
    const raw = JSON.stringify(ra.body);
    expect(raw).not.toContain(a.sub);
    expect(raw).not.toContain(b.sub);
    expect(raw).not.toContain('@uni.edu');

    const rb = await get(b, '/matches');
    expect(rb.body.data[0].partner).toMatchObject({ id: a.id, nickname: 'alice_a' });
  });

  it('shows nothing to the target of a one-sided crush, and nothing to outsiders', async () => {
    await crush(a, b.id); // b has no idea
    expect((await get(b, '/matches')).body).toEqual({ data: [] });
    await makeMatch(a, b);
    expect((await get(c, '/matches')).body).toEqual({ data: [] });
  });

  it('includes a preview of the latest message', async () => {
    const matchId = await makeMatch(a, b);
    await send(a, matchId, { content: 'first' });
    await send(b, matchId, { content: 'x'.repeat(200) });
    const mine = (await get(a, '/matches')).body.data[0].lastMessage;
    expect(mine.mine).toBe(false);
    expect(mine.preview).toHaveLength(80);
    expect((await get(b, '/matches')).body.data[0].lastMessage.mine).toBe(true);
  });

  it('hides matches whose partner is suspended, deleted or blocked (either direction)', async () => {
    const m1 = await makeMatch(a, b);
    const d = await createUser(pool, campus, { nickname: 'dave_d' });
    const e = await createUser(pool, campus, { nickname: 'erin_e' });
    const f = await createUser(pool, campus, { nickname: 'fred_f' });
    await makeMatch(a, d);
    await makeMatch(a, e);
    await makeMatch(a, f);
    await pool.query(`UPDATE users SET account_status = 'SUSPENDED' WHERE id = $1`, [d.id]);
    await pool.query(`UPDATE users SET account_status = 'DELETED' WHERE id = $1`, [e.id]);
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [f.id, a.id]);
    const list = (await get(a, '/matches')).body.data;
    expect(list.map((m: { id: string }) => m.id)).toEqual([m1]);
  });
});

describe('GET /matches/:matchId', () => {
  it('returns the match to both participants only', async () => {
    const matchId = await makeMatch(a, b);
    expect((await get(a, `/matches/${matchId}`)).body.data.partner.nickname).toBe('bob_b');
    expect((await get(b, `/matches/${matchId}`)).body.data.partner.nickname).toBe('alice_a');
  });

  it('answers non-participants, guessed ids and unknown ids identically (404)', async () => {
    const matchId = await makeMatch(a, b);
    const outsider = await get(c, `/matches/${matchId}`);
    const unknown = await get(c, `/matches/${randomUUID()}`);
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(NOT_FOUND);
    expect(unknown.body).toEqual(NOT_FOUND);
    expect(outsider.text).not.toContain('bob_b');
  });

  it('rejects malformed ids and unauthenticated calls', async () => {
    expect((await get(a, '/matches/not-a-uuid')).status).toBe(422);
    expect((await get(a, "/matches/1' OR '1'='1")).status).toBe(422);
    const matchId = await makeMatch(a, b);
    expect((await request(app).get(`/api/v1/matches/${matchId}`)).status).toBe(401);
  });
});

describe('POST /matches/:matchId/unmatch', () => {
  it('lets a participant unmatch; the conversation disappears for both people', async () => {
    const matchId = await makeMatch(a, b);
    await send(a, matchId, { content: 'hello' });
    const res = await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(b.h);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'unmatched' } });

    for (const u of [a, b]) {
      expect((await get(u, '/matches')).body).toEqual({ data: [] });
      expect((await get(u, `/matches/${matchId}`)).status).toBe(404);
      expect((await get(u, `/matches/${matchId}/messages`)).status).toBe(404);
      expect((await send(u, matchId, { content: 'still there?' })).status).toBe(404);
    }
    const row = (await pool.query('SELECT status, unmatched_by, unmatched_at FROM matches WHERE id = $1', [matchId])).rows[0];
    expect(row.status).toBe('UNMATCHED');
    expect(row.unmatched_by).toBe(b.id);
    expect(row.unmatched_at).not.toBeNull();
    expect(await count('messages')).toBe(1); // retained (inaccessible) for report review; purged by the retention job
  });

  it('removes each person from the other’s discovery after unmatching', async () => {
    const matchId = await makeMatch(a, b);
    await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(a.h);
    const seen = (await get(a, '/profiles/discover')).body.data.map((p: { id: string }) => p.id);
    expect(seen).not.toContain(b.id);
  });

  it('does not let outsiders unmatch, and does not reveal the match exists', async () => {
    const matchId = await makeMatch(a, b);
    const res = await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(c.h);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await pool.query('SELECT status FROM matches WHERE id = $1', [matchId])).rows[0].status).toBe('ACTIVE');
  });

  it('is not repeatable and requires authentication', async () => {
    const matchId = await makeMatch(a, b);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(a.h)).status).toBe(200);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(a.h)).status).toBe(404);
    expect((await request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(b.h)).status).toBe(404);
  });

  it('stops new messages immediately, even when racing with senders', async () => {
    const matchId = await makeMatch(a, b);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => send(i % 2 ? a : b, matchId, { content: `m${i}` })),
      request(app).post(`/api/v1/matches/${matchId}/unmatch`).set(a.h),
    ]);
    const stored = await count('messages');
    const created = results.slice(0, 10).filter((r) => r.status === 201).length;
    expect(stored).toBe(created); // every 201 was really stored, every 404 really was not
    expect(results.slice(0, 10).every((r) => r.status === 201 || r.status === 404)).toBe(true);
    expect((await send(a, matchId, { content: 'late' })).status).toBe(404);
    expect(await count('messages')).toBe(stored);
  });
});

describe('POST /matches/:matchId/messages', () => {
  it('stores a message for a participant and returns it without sender ids', async () => {
    const matchId = await makeMatch(a, b);
    const res = await send(a, matchId, { content: '  Hi Bob 👋  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ content: 'Hi Bob 👋', mine: true });
    expect(Object.keys(res.body.data).sort()).toEqual(['content', 'createdAt', 'id', 'mine']);
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);
    const row = (await pool.query('SELECT sender_id, match_id FROM messages')).rows[0];
    expect(row).toEqual({ sender_id: a.id, match_id: matchId });
  });

  it('ignores client-supplied sender ids (strict body)', async () => {
    const matchId = await makeMatch(a, b);
    const res = await send(a, matchId, { content: 'hi', senderId: b.id });
    expect(res.status).toBe(422);
    expect(await count('messages')).toBe(0);
  });

  it('rejects empty, whitespace-only, missing, non-string and oversized content', async () => {
    const matchId = await makeMatch(a, b);
    for (const body of [{}, { content: '' }, { content: '   \n\t ' }, { content: '​\u0000' }, { content: 42 }, { content: ['a'] }, { content: null }, { content: 'x'.repeat(1001) }]) {
      expect((await send(a, matchId, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await send(a, matchId, { content: 'x'.repeat(1000) })).status).toBe(201);
    expect(await count('messages')).toBe(1);
  });

  it('rejects very large request bodies before parsing', async () => {
    const matchId = await makeMatch(a, b);
    const res = await send(a, matchId, { content: 'x'.repeat(50_000) });
    expect(res.status).toBe(413);
  });

  it('stores markup as inert text and strips control characters', async () => {
    const matchId = await makeMatch(a, b);
    const res = await send(a, matchId, { content: '<img src=x onerror=alert(1)>\u0000‮ hi' });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('<img src=x onerror=alert(1)> hi');
    // The API only serves JSON (never HTML), with nosniff, so stored text cannot execute.
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('preserves line breaks in multi-line messages', async () => {
    const matchId = await makeMatch(a, b);
    const res = await send(a, matchId, { content: 'line one\n\n\n\nline two' });
    expect(res.body.data.content).toBe('line one\n\nline two');
  });

  it('refuses outsiders and guessed ids with the same 404', async () => {
    const matchId = await makeMatch(a, b);
    const r1 = await send(c, matchId, { content: 'let me in' });
    const r2 = await send(c, randomUUID(), { content: 'let me in' });
    expect(r1.status).toBe(404);
    expect(r1.body).toEqual(NOT_FOUND);
    expect(r2.body).toEqual(NOT_FOUND);
    expect(await count('messages')).toBe(0);
  });

  it('refuses unauthenticated, ineligible and suspended senders', async () => {
    const matchId = await makeMatch(a, b);
    expect((await request(app).post(`/api/v1/matches/${matchId}/messages`).send({ content: 'x' })).status).toBe(401);
    await pool.query(`UPDATE users SET campus_status = 'UNVERIFIED' WHERE id = $1`, [a.id]);
    expect((await send(a, matchId, { content: 'x' })).status).toBe(403);
    await pool.query(`UPDATE users SET campus_status = 'VERIFIED', account_status = 'SUSPENDED' WHERE id = $1`, [a.id]);
    expect((await send(a, matchId, { content: 'x' })).body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await count('messages')).toBe(0);
  });

  it('refuses messages once either side has blocked the other, or the partner is suspended', async () => {
    const matchId = await makeMatch(a, b);
    expect((await send(a, matchId, { content: 'ok' })).status).toBe(201);
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b.id, a.id]); // b blocks a
    expect((await send(a, matchId, { content: 'blocked?' })).status).toBe(404);
    expect((await send(b, matchId, { content: 'i blocked you' })).status).toBe(404);
    expect((await get(a, `/matches/${matchId}/messages`)).status).toBe(404);
    expect((await get(b, `/matches/${matchId}/messages`)).status).toBe(404);
    await pool.query('DELETE FROM blocks');
    expect((await send(a, matchId, { content: 'back' })).status).toBe(201);
    await pool.query(`UPDATE users SET account_status = 'SUSPENDED' WHERE id = $1`, [b.id]);
    expect((await send(a, matchId, { content: 'to suspended' })).status).toBe(404);
    expect(await count('messages')).toBe(2);
  });

  it('rate limits message sending per user', async () => {
    const limited = setupApp({ message: { windowMs: 60_000, max: 3 } });
    try {
      const matchId = await makeMatch(a, b);
      const post = (u: TestUser) => request(limited.app).post(`/api/v1/matches/${matchId}/messages`).set(u.h).send({ content: 'hi' });
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await post(a)).status);
      expect(statuses).toEqual([201, 201, 201, 429, 429]);
      expect((await post(b)).status).toBe(201); // b has their own quota
      expect(await count('messages')).toBe(4);
    } finally {
      await limited.pool.end();
    }
  });
});

describe('GET /matches/:matchId/messages', () => {
  it('returns the conversation oldest→newest with per-viewer "mine" flags', async () => {
    const matchId = await makeMatch(a, b);
    await send(a, matchId, { content: 'one' });
    await send(b, matchId, { content: 'two' });
    await send(a, matchId, { content: 'three' });
    const ra = await get(a, `/matches/${matchId}/messages`);
    expect(ra.status).toBe(200);
    expect(ra.body.data.map((m: { content: string }) => m.content)).toEqual(['one', 'two', 'three']);
    expect(ra.body.data.map((m: { mine: boolean }) => m.mine)).toEqual([true, false, true]);
    expect(ra.body.page).toEqual({ nextCursor: null });
    const rb = await get(b, `/matches/${matchId}/messages`);
    expect(rb.body.data.map((m: { mine: boolean }) => m.mine)).toEqual([false, true, false]);
    const raw = JSON.stringify(ra.body);
    expect(raw).not.toContain(a.id);
    expect(raw).not.toContain(b.id);
    expect(raw).not.toMatch(/sender/i);
  });

  it('returns an empty conversation as an empty list', async () => {
    const matchId = await makeMatch(a, b);
    expect((await get(a, `/matches/${matchId}/messages`)).body).toEqual({ data: [], page: { nextCursor: null } });
  });

  it('refuses outsiders, guessed ids and unauthenticated callers', async () => {
    const matchId = await makeMatch(a, b);
    await send(a, matchId, { content: 'private words' });
    const r1 = await get(c, `/matches/${matchId}/messages`);
    expect(r1.status).toBe(404);
    expect(r1.text).not.toContain('private words');
    expect((await get(c, `/matches/${randomUUID()}/messages`)).body).toEqual(NOT_FOUND);
    expect((await request(app).get(`/api/v1/matches/${matchId}/messages`)).status).toBe(401);
    expect((await get(a, '/matches/nope/messages')).status).toBe(422);
  });

  it('pages backwards with "before" and never repeats or skips a message', async () => {
    const matchId = await makeMatch(a, b);
    for (let i = 1; i <= 7; i++) await send(i % 2 ? a : b, matchId, { content: `m${i}` });
    const p1 = await get(a, `/matches/${matchId}/messages?limit=3`);
    expect(p1.body.data.map((m: { content: string }) => m.content)).toEqual(['m5', 'm6', 'm7']);
    expect(p1.body.page.nextCursor).toBe(p1.body.data[0].id);
    const p2 = await get(a, `/matches/${matchId}/messages?limit=3&before=${p1.body.page.nextCursor}`);
    expect(p2.body.data.map((m: { content: string }) => m.content)).toEqual(['m2', 'm3', 'm4']);
    const p3 = await get(a, `/matches/${matchId}/messages?limit=3&before=${p2.body.page.nextCursor}`);
    expect(p3.body.data.map((m: { content: string }) => m.content)).toEqual(['m1']);
    expect(p3.body.page.nextCursor).toBeNull();
  });

  it('supports polling for new messages with "after"', async () => {
    const matchId = await makeMatch(a, b);
    const first = await send(a, matchId, { content: 'm1' });
    await send(a, matchId, { content: 'm2' });
    const poll = await get(b, `/matches/${matchId}/messages?after=${first.body.data.id}`);
    expect(poll.body.data.map((m: { content: string }) => m.content)).toEqual(['m2']);
    const last = poll.body.data[0].id;
    expect((await get(b, `/matches/${matchId}/messages?after=${last}`)).body.data).toEqual([]);
    await send(b, matchId, { content: 'm3' });
    const again = await get(a, `/matches/${matchId}/messages?after=${last}`);
    expect(again.body.data.map((m: { content: string; mine: boolean }) => [m.content, m.mine])).toEqual([['m3', false]]);
  });

  it('rejects bad paging parameters and cursors from another conversation', async () => {
    const matchId = await makeMatch(a, b);
    const other = await createUser(pool, campus, { nickname: 'dave_d' });
    const otherMatch = await makeMatch(c, other);
    const foreign = await send(c, otherMatch, { content: 'not yours' });
    const mine = await send(a, matchId, { content: 'mine' });
    for (const qs of ['?limit=0', '?limit=101', '?limit=x', '?before=zzz', '?after=zzz', `?before=${mine.body.data.id}&after=${mine.body.data.id}`, `?before=${randomUUID()}`, `?before=${foreign.body.data.id}`]) {
      expect((await get(a, `/matches/${matchId}/messages${qs}`)).status, qs).toBe(422);
    }
  });
});
