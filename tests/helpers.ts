import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import pg from 'pg';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig, type Config, type Limits } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';

export const JWT_SECRET = 'test-secret-test-secret-test-secret!';
export const SUPABASE_URL = 'https://test.supabase.co';
export const MODERATOR_SUB = '00000000-0000-4000-8000-00000000aaaa';

/** Admin connection used only to (re)create the throwaway test database. */
export const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres';
export const TEST_DB_NAME = 'hush_test';

export function testDbUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

const HUGE = { windowMs: 60_000, max: 1_000_000 };
const hugeLimits: Limits = { global: HUGE, auth: HUGE, crush: HUGE, message: HUGE, report: HUGE, safety: HUGE };

export function testConfig(limits: Partial<Limits> = {}): Config {
  return loadConfig(
    {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl(),
      SUPABASE_URL,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      CORS_ORIGINS: 'http://localhost:5173',
      MODERATOR_AUTH_SUBJECTS: MODERATOR_SUB,
      DB_POOL_MAX: '20',
    },
    { limits: { ...hugeLimits, ...limits } },
  );
}

export interface TestEnv {
  pool: pg.Pool;
  app: Express;
  config: Config;
}

export function setupApp(limits: Partial<Limits> = {}): TestEnv {
  const config = testConfig(limits);
  const pool = createPool(config.databaseUrl, config.dbPoolMax);
  return { pool, app: createApp({ pool, config }), config };
}

export interface TokenOptions {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  role?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  secret?: string;
}

export async function makeToken(o: TokenOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: o.email, email_verified: o.emailVerified ?? true, role: o.role ?? 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(o.sub)
    .setIssuer(o.iss ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(o.aud ?? 'authenticated')
    .setIssuedAt(now - 10)
    .setExpirationTime(o.exp ?? now + 3600)
    .sign(new TextEncoder().encode(o.secret ?? JWT_SECRET));
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE notifications, messages, matches, crushes, blocks, reports, profiles, users, campuses RESTART IDENTITY CASCADE',
  );
}

export async function seedCampus(
  pool: pg.Pool,
  o: { name?: string; domains?: string[]; requireVerifiedAge?: boolean; active?: boolean } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO campuses (name, verification_config, is_active) VALUES ($1, $2, $3) RETURNING id',
    [
      o.name ?? `Test University ${randomUUID().slice(0, 6)}`,
      JSON.stringify({ emailDomains: o.domains ?? ['uni.edu'], requireVerifiedAge: o.requireVerifiedAge ?? false }),
      o.active ?? true,
    ],
  );
  return rows[0]!.id;
}

export interface TestUser {
  id: string;
  sub: string;
  nickname: string;
  token: string;
  h: { Authorization: string };
}

let counter = 0;
export async function createUser(
  pool: pg.Pool,
  campusId: string,
  o: {
    nickname?: string;
    bio?: string;
    interests?: string[];
    discoverable?: boolean;
    ageStatus?: 'UNVERIFIED' | 'SELF_ATTESTED' | 'VERIFIED';
    campusStatus?: 'UNVERIFIED' | 'VERIFIED';
    status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  } = {},
): Promise<TestUser> {
  const sub = randomUUID();
  const nickname = o.nickname ?? `user_${++counter}_${randomUUID().slice(0, 4)}`;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (auth_subject, campus_id, age_status, campus_status, account_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sub, campusId, o.ageStatus ?? 'SELF_ATTESTED', o.campusStatus ?? 'VERIFIED', o.status ?? 'ACTIVE'],
  );
  const id = u.rows[0]!.id;
  await pool.query(
    `INSERT INTO profiles (user_id, nickname, nickname_key, bio, interests, discoverable)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, nickname, nickname.toLowerCase(), o.bio ?? 'hello there', o.interests ?? ['music'], o.discoverable ?? true],
  );
  const token = await makeToken({ sub, email: `${nickname}@uni.edu` });
  return { id, sub, nickname, token, h: bearer(token) };
}
