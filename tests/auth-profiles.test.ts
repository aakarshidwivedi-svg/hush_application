import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, makeToken, resetDb, seedCampus, setupApp, SUPABASE_URL } from './helpers.js';

const { pool, app } = setupApp();
afterAll(() => pool.end());

let campus: string;
beforeEach(async () => {
  await resetDb(pool);
  campus = await seedCampus(pool, { name: 'Test University', domains: ['uni.edu'] });
});

const body = (over: Record<string, unknown> = {}) => ({
  campusId: campus,
  nickname: 'Starlight',
  bio: 'Coffee, chess and bad puns.',
  interests: ['Chess', 'chess', 'Music'],
  ageAttestation: true,
  ...over,
});

async function signUp(email = 'maya@uni.edu', over: Record<string, unknown> = {}, tokenOver = {}) {
  const sub = randomUUID();
  const token = await makeToken({ sub, email, ...tokenOver });
  const res = await request(app).post('/api/v1/auth/complete-profile').set(bearer(token)).send(body(over));
  return { sub, token, res };
}

describe('health and public endpoints', () => {
  it('serves health and the campus list without authentication', async () => {
    expect((await request(app).get('/api/v1/health')).body).toEqual({ data: { status: 'ok' } });
    const res = await request(app).get('/api/v1/campuses');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: campus, name: 'Test University', emailDomains: ['uni.edu'] }]);
  });

  it('returns a JSON 404 for unknown routes and sets security headers', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('only allows configured CORS origins', async () => {
    const good = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects malformed JSON with 400', async () => {
    const { token } = await signUp('x@uni.edu', { nickname: 'valid_name' });
    const res = await request(app).patch('/api/v1/profiles/me').set(bearer(token)).set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('token verification', () => {
  const paths = ['/api/v1/profiles/me'];

  it('rejects missing and malformed Authorization headers', async () => {
    for (const p of paths) {
      expect((await request(app).get(p)).status).toBe(401);
      expect((await request(app).get(p).set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
      expect((await request(app).get(p).set('Authorization', 'Basic abc')).status).toBe(401);
    }
  });

  it('rejects expired tokens', async () => {
    const token = await makeToken({ sub: randomUUID(), email: 'a@uni.edu', exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request(app).get('/api/v1/profiles/me').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects tokens with a wrong signature, audience, issuer or role', async () => {
    const sub = randomUUID();
    const cases = [
      await makeToken({ sub, secret: 'a-completely-different-secret-value-123' }),
      await makeToken({ sub, aud: 'someone-else' }),
      await makeToken({ sub, iss: 'https://evil.example/auth/v1' }),
      await makeToken({ sub, role: 'anon' }),
    ];
    for (const t of cases) expect((await request(app).get('/api/v1/profiles/me').set(bearer(t))).status).toBe(401);
  });

  it('rejects unsigned (alg=none) tokens', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: randomUUID(), role: 'authenticated', aud: 'authenticated', iss: `${SUPABASE_URL}/auth/v1`, exp: 9999999999 })}.AAAA`;
    expect((await request(app).get('/api/v1/profiles/me').set(bearer(t))).status).toBe(401);
  });
});

describe('POST /auth/complete-profile', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/v1/auth/complete-profile').send(body())).status).toBe(401);
  });

  it('creates a profile for a verified campus email and exposes no private data', async () => {
    const { sub, res } = await signUp('maya@uni.edu');
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d).toMatchObject({
      nickname: 'Starlight',
      bio: 'Coffee, chess and bad puns.',
      interests: ['Chess', 'Music'], // case-insensitive de-duplication
      discoverable: true,
      campus: { id: campus, name: 'Test University' },
      account: { status: 'ACTIVE', ageStatus: 'SELF_ATTESTED', campusStatus: 'VERIFIED', eligible: true, missing: [] },
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('maya@uni.edu');
    expect(raw).not.toContain(sub);
    expect(raw).not.toMatch(/auth_?subject/i);
  });

  it('accepts campus subdomains but not look-alike domains', async () => {
    expect((await signUp('a@students.uni.edu', { nickname: 'sub_ok' })).res.status).toBe(201);
    const bad = await signUp('a@notuni.edu', { nickname: 'lookalike' });
    expect(bad.res.status).toBe(403);
    expect(bad.res.body.error.code).toBe('CAMPUS_EMAIL_MISMATCH');
    expect((await signUp('a@uni.edu.evil.com', { nickname: 'lookalike2' })).res.status).toBe(403);
  });

  it('refuses unverified emails and tokens without an email', async () => {
    const unverified = await signUp('maya@uni.edu', {}, { emailVerified: false });
    expect(unverified.res.status).toBe(403);
    expect(unverified.res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const noEmail = await signUp('unused@uni.edu', { nickname: 'noemail' }, { email: undefined });
    expect(noEmail.res.status).toBe(403);
  });

  it('requires the 18+ attestation', async () => {
    expect((await signUp('a@uni.edu', { ageAttestation: false })).res.status).toBe(422);
    expect((await signUp('b@uni.edu', { ageAttestation: undefined, nickname: 'noage' })).res.status).toBe(422);
  });

  it('never trusts client-supplied status fields', async () => {
    for (const extra of [{ campusStatus: 'VERIFIED' }, { ageStatus: 'VERIFIED' }, { userId: randomUUID() }, { status: 'ACTIVE' }, { role: 'moderator' }]) {
      const res = (await signUp('a@uni.edu', { ...extra, nickname: `x${Math.floor(Math.random() * 1e6)}` })).res;
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(0);
  });

  it('rejects invalid, reserved and duplicate nicknames (case-insensitive)', async () => {
    for (const nickname of ['ab', 'has space', 'emoji😀name', 'x'.repeat(25), 'admin', '<script>']) {
      expect((await signUp('a@uni.edu', { nickname })).res.status, nickname).toBe(422);
    }
    expect((await signUp('a@uni.edu', { nickname: 'Starlight' })).res.status).toBe(201);
    const dup = await signUp('b@uni.edu', { nickname: 'STARLIGHT' });
    expect(dup.res.status).toBe(409);
    expect(dup.res.body.error.code).toBe('NICKNAME_TAKEN');
  });

  it('rejects a second onboarding for the same account', async () => {
    const { token } = await signUp('a@uni.edu', { nickname: 'first_one' });
    const again = await request(app).post('/api/v1/auth/complete-profile').set(bearer(token)).send(body({ nickname: 'second_one' }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ONBOARDED');
  });

  it('rejects unknown or inactive campuses', async () => {
    expect((await signUp('a@uni.edu', { campusId: randomUUID() })).res.status).toBe(422);
    const inactive = await seedCampus(pool, { name: 'Closed U', active: false });
    expect((await signUp('a@uni.edu', { campusId: inactive })).res.status).toBe(422);
  });

  it('validates and cleans text fields', async () => {
    expect((await signUp('a@uni.edu', { bio: 'x'.repeat(281) })).res.status).toBe(422);
    expect((await signUp('b@uni.edu', { interests: Array.from({ length: 11 }, (_, i) => `i${i}`), nickname: 'many_ints' })).res.status).toBe(422);
    expect((await signUp('c@uni.edu', { avatarUrl: 'http://insecure.example/a.png', nickname: 'http_av' })).res.status).toBe(422);
    expect((await signUp('d@uni.edu', { avatarUrl: 'javascript:alert(1)', nickname: 'js_av' })).res.status).toBe(422);
    const ok = await signUp('e@uni.edu', { bio: ' hi‮\u0000 there  ', nickname: 'cleaned' });
    expect(ok.res.status).toBe(201);
    expect(ok.res.body.data.bio).toBe('hi there');
  });

  it('leaves the account ineligible when the campus requires verified age', async () => {
    const strict = await seedCampus(pool, { name: 'Strict U', domains: ['strict.edu'], requireVerifiedAge: true });
    const { res } = await signUp('a@strict.edu', { campusId: strict });
    expect(res.status).toBe(201);
    expect(res.body.data.account).toMatchObject({ ageStatus: 'SELF_ATTESTED', eligible: false, missing: ['age_verification'] });
  });
});

describe('GET /profiles/me', () => {
  it('asks a brand-new account to finish onboarding', async () => {
    const token = await makeToken({ sub: randomUUID(), email: 'new@uni.edu' });
    const res = await request(app).get('/api/v1/profiles/me').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  it('returns only the caller’s own profile', async () => {
    const a = await createUser(pool, campus, { nickname: 'alpha_user' });
    const b = await createUser(pool, campus, { nickname: 'beta_user' });
    expect((await request(app).get('/api/v1/profiles/me').set(a.h)).body.data.nickname).toBe('alpha_user');
    expect((await request(app).get('/api/v1/profiles/me').set(b.h)).body.data.nickname).toBe('beta_user');
  });

  it('reports missing verification for unverified accounts', async () => {
    const u = await createUser(pool, campus, { campusStatus: 'UNVERIFIED', ageStatus: 'UNVERIFIED' });
    const res = await request(app).get('/api/v1/profiles/me').set(u.h);
    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({ eligible: false, missing: ['campus_verification', 'age_verification'] });
  });

  it('treats deleted accounts as unauthenticated', async () => {
    const u = await createUser(pool, campus, { status: 'DELETED' });
    expect((await request(app).get('/api/v1/profiles/me').set(u.h)).status).toBe(401);
  });
});

describe('PATCH /profiles/me', () => {
  it('updates allowed fields for the authenticated user only', async () => {
    const a = await createUser(pool, campus, { nickname: 'alpha_user', bio: 'old' });
    const b = await createUser(pool, campus, { nickname: 'beta_user', bio: 'untouched' });
    const res = await request(app)
      .patch('/api/v1/profiles/me')
      .set(a.h)
      .send({ bio: 'new bio', interests: ['Hiking', 'Film'], discoverable: false, nickname: 'Alpha_2', avatarUrl: 'https://img.example/a.png' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bio: 'new bio', interests: ['Hiking', 'Film'], discoverable: false, nickname: 'Alpha_2', avatarUrl: 'https://img.example/a.png' });
    expect((await request(app).get('/api/v1/profiles/me').set(b.h)).body.data.bio).toBe('untouched');
  });

  it('can clear the avatar', async () => {
    const a = await createUser(pool, campus);
    await request(app).patch('/api/v1/profiles/me').set(a.h).send({ avatarUrl: 'https://img.example/a.png' });
    const res = await request(app).patch('/api/v1/profiles/me').set(a.h).send({ avatarUrl: null });
    expect(res.body.data.avatarUrl).toBeNull();
  });

  it('requires authentication', async () => {
    expect((await request(app).patch('/api/v1/profiles/me').send({ bio: 'x' })).status).toBe(401);
  });

  it('rejects privilege-escalating or ownership fields', async () => {
    const a = await createUser(pool, campus, { campusStatus: 'UNVERIFIED' });
    const other = await createUser(pool, campus);
    for (const extra of [
      { campusStatus: 'VERIFIED' },
      { ageStatus: 'VERIFIED' },
      { status: 'ACTIVE' },
      { campusId: randomUUID() },
      { userId: other.id },
      { user_id: other.id },
      { role: 'moderator' },
    ]) {
      const res = await request(app).patch('/api/v1/profiles/me').set(a.h).send({ bio: 'ok', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const { rows } = await pool.query('SELECT campus_status FROM users WHERE id = $1', [a.id]);
    expect(rows[0].campus_status).toBe('UNVERIFIED');
  });

  it('rejects empty bodies, bad values and taken nicknames', async () => {
    const a = await createUser(pool, campus, { nickname: 'alpha_user' });
    await createUser(pool, campus, { nickname: 'beta_user' });
    expect((await request(app).patch('/api/v1/profiles/me').set(a.h).send({})).status).toBe(422);
    expect((await request(app).patch('/api/v1/profiles/me').set(a.h).send({ bio: 'x'.repeat(300) })).status).toBe(422);
    expect((await request(app).patch('/api/v1/profiles/me').set(a.h).send({ discoverable: 'yes' })).status).toBe(422);
    const taken = await request(app).patch('/api/v1/profiles/me').set(a.h).send({ nickname: 'BETA_USER' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('NICKNAME_TAKEN');
  });

  it('lets a user keep their own nickname when changing only its case', async () => {
    const a = await createUser(pool, campus, { nickname: 'alpha_user' });
    expect((await request(app).patch('/api/v1/profiles/me').set(a.h).send({ nickname: 'ALPHA_USER' })).status).toBe(200);
  });

  it('blocks suspended accounts', async () => {
    const a = await createUser(pool, campus, { status: 'SUSPENDED' });
    const res = await request(app).patch('/api/v1/profiles/me').set(a.h).send({ bio: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('rate limiting', () => {
  it('returns 429 with a consistent error body once the limit is hit', async () => {
    const limited = setupApp({ auth: { windowMs: 60_000, max: 2 } });
    try {
      const token = await makeToken({ sub: randomUUID(), email: 'a@uni.edu' });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await request(limited.app).post('/api/v1/auth/complete-profile').set(bearer(token)).send({})).status);
      }
      expect(statuses).toEqual([422, 422, 429, 429]);
      const res = await request(limited.app).post('/api/v1/auth/complete-profile').set(bearer(token)).send({});
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.pool.end();
    }
  });
});
