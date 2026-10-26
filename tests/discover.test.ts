import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, resetDb, seedCampus, setupApp, type TestUser } from './helpers.js';

const { pool, app } = setupApp();
afterAll(() => pool.end());

let campus: string;
let viewer: TestUser;

beforeEach(async () => {
  await resetDb(pool);
  campus = await seedCampus(pool, { name: 'Test University' });
  viewer = await createUser(pool, campus, { nickname: 'viewer_one' });
});

const discoverAs = (u: TestUser, qs = '') => request(app).get(`/api/v1/profiles/discover${qs}`).set(u.h);
const nicknames = (res: request.Response): string[] => res.body.data.map((c: { nickname: string }) => c.nickname).sort();

describe('GET /profiles/discover — access', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/profiles/discover')).status).toBe(401);
  });

  it('requires completed onboarding', async () => {
    const { makeToken, bearer } = await import('./helpers.js');
    const token = await makeToken({ sub: randomUUID(), email: 'n@uni.edu' });
    const res = await request(app).get('/api/v1/profiles/discover').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  it.each([
    ['campus-unverified', { campusStatus: 'UNVERIFIED' as const }, ['campus_verification']],
    ['age-unverified', { ageStatus: 'UNVERIFIED' as const }, ['age_verification']],
  ])('refuses %s accounts', async (_name, over, missing) => {
    const u = await createUser(pool, campus, over);
    const res = await discoverAs(u);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
    expect(res.body.error.details.missing).toEqual(missing);
  });

  it('refuses suspended accounts', async () => {
    const u = await createUser(pool, campus, { status: 'SUSPENDED' });
    const res = await discoverAs(u);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('requires verified age on campuses that demand it', async () => {
    const strict = await seedCampus(pool, { name: 'Strict U', requireVerifiedAge: true });
    const selfAttested = await createUser(pool, strict, { ageStatus: 'SELF_ATTESTED' });
    const verified = await createUser(pool, strict, { ageStatus: 'VERIFIED', nickname: 'verified_one' });
    expect((await discoverAs(selfAttested)).status).toBe(403);
    const res = await discoverAs(verified);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]); // the self-attested user is not shown to anyone
  });
});

describe('GET /profiles/discover — who is shown', () => {
  it('shows only eligible, active, discoverable users from the viewer’s own campus', async () => {
    const otherCampus = await seedCampus(pool, { name: 'Other U' });
    await createUser(pool, campus, { nickname: 'visible_a' });
    await createUser(pool, campus, { nickname: 'visible_b' });
    await createUser(pool, campus, { nickname: 'hidden_profile', discoverable: false });
    await createUser(pool, campus, { nickname: 'suspended_user', status: 'SUSPENDED' });
    await createUser(pool, campus, { nickname: 'deleted_user', status: 'DELETED' });
    await createUser(pool, campus, { nickname: 'unverified_campus', campusStatus: 'UNVERIFIED' });
    await createUser(pool, campus, { nickname: 'unverified_age', ageStatus: 'UNVERIFIED' });
    await createUser(pool, otherCampus, { nickname: 'other_campus' });

    const res = await discoverAs(viewer);
    expect(res.status).toBe(200);
    expect(nicknames(res)).toEqual(['visible_a', 'visible_b']); // never the viewer themself
  });

  it('hides users blocked in either direction, and existing matches', async () => {
    const iBlocked = await createUser(pool, campus, { nickname: 'i_blocked' });
    const blockedMe = await createUser(pool, campus, { nickname: 'blocked_me' });
    const matched = await createUser(pool, campus, { nickname: 'matched_user' });
    await createUser(pool, campus, { nickname: 'still_visible' });
    await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2), ($3, $1)', [viewer.id, iBlocked.id, blockedMe.id]);
    const [lo, hi] = [viewer.id, matched.id].sort();
    await pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $2)', [lo, hi]);
    expect(nicknames(await discoverAs(viewer))).toEqual(['still_visible']);
  });

  it('returns an empty list (not an error) when nobody is available', async () => {
    const res = await discoverAs(viewer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: { nextCursor: null } });
  });
});

describe('GET /profiles/discover — privacy', () => {
  it('exposes only approved public fields', async () => {
    const other = await createUser(pool, campus, { nickname: 'public_one', bio: 'my bio', interests: ['art', 'film'] });
    const res = await discoverAs(viewer);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['avatarUrl', 'bio', 'crushed', 'id', 'interests', 'nickname']);
    expect(res.body.data[0]).toMatchObject({ id: other.id, nickname: 'public_one', bio: 'my bio', interests: ['art', 'film'], crushed: false });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(other.sub); // auth subject
    expect(raw).not.toContain('@uni.edu'); // email
    expect(raw).not.toMatch(/auth_?subject|campus_?status|age_?status|account_?status|student|email|count|popular|rank|likes/i);
  });

  it('is byte-for-byte identical whether or not other people have crushed on the viewer', async () => {
    const people = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((n) => createUser(pool, campus, { nickname: `person_${n}` })));
    const before = await discoverAs(viewer);
    await pool.query(
      'INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $4), ($2, $4), ($3, $4)',
      [people[0]!.id, people[1]!.id, people[2]!.id, viewer.id],
    );
    const after = await discoverAs(viewer);
    expect(after.body).toEqual(before.body);
    expect(after.text).toBe(before.text);
  });

  it('reflects only the viewer’s own crushes, never the other side’s', async () => {
    const target = await createUser(pool, campus, { nickname: 'target_user' });
    await pool.query('INSERT INTO crushes (sender_id, receiver_id) VALUES ($1, $2)', [viewer.id, target.id]);
    // viewer sees their own crush state…
    expect((await discoverAs(viewer)).body.data.find((c: { id: string }) => c.id === target.id).crushed).toBe(true);
    // …but the target, who has no idea, sees nothing different about the viewer.
    const seenByTarget = (await discoverAs(target)).body.data.find((c: { id: string }) => c.id === viewer.id);
    expect(seenByTarget.crushed).toBe(false);
    expect(Object.keys(seenByTarget).sort()).toEqual(['avatarUrl', 'bio', 'crushed', 'id', 'interests', 'nickname']);
  });
});

describe('GET /profiles/discover — pagination', () => {
  it('pages through everyone exactly once with stable ordering', async () => {
    for (let i = 0; i < 7; i++) await createUser(pool, campus, { nickname: `person_${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await discoverAs(viewer, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(3);
      seen.push(...res.body.data.map((c: { id: string }) => c.id));
      cursor = res.body.page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const firstAgain = await discoverAs(viewer, '?limit=7');
    expect(firstAgain.body.data.map((c: { id: string }) => c.id)).toEqual(seen);
    expect(firstAgain.body.page.nextCursor).toBeNull();
  });

  it('rejects invalid limits and cursors', async () => {
    for (const qs of ['?limit=0', '?limit=51', '?limit=abc', '?cursor=nope', "?cursor=' OR 1=1 --"]) {
      expect((await discoverAs(viewer, qs)).status, qs).toBe(422);
    }
  });
});
