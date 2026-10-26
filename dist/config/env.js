import { z } from 'zod';
export const defaultLimits = {
    global: { windowMs: 60_000, max: 300 },
    auth: { windowMs: 3_600_000, max: 20 },
    crush: { windowMs: 3_600_000, max: 60 },
    message: { windowMs: 60_000, max: 40 },
    report: { windowMs: 3_600_000, max: 10 },
    safety: { windowMs: 3_600_000, max: 60 },
};
const csv = (v) => v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a URL'),
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),
    MODERATOR_AUTH_SUBJECTS: z.string().default(''),
    AVATAR_HOSTS: z.string().default(''),
});
/**
 * Parse and validate environment variables. Throws a readable error on misconfiguration
 * so the API never starts with missing auth settings.
 */
export function loadConfig(source = process.env, overrides = {}) {
    // Treat empty strings (e.g. `SUPABASE_JWT_SECRET=`) as unset.
    const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
    const parsed = envSchema.safeParse(cleaned);
    if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid environment configuration: ${msg}`);
    }
    const e = parsed.data;
    const base = e.SUPABASE_URL.replace(/\/+$/, '');
    return {
        env: e.NODE_ENV,
        port: e.PORT,
        logLevel: e.LOG_LEVEL,
        databaseUrl: e.DATABASE_URL,
        directUrl: e.DIRECT_URL,
        dbPoolMax: e.DB_POOL_MAX,
        corsOrigins: csv(e.CORS_ORIGINS),
        trustProxy: e.TRUST_PROXY,
        auth: {
            issuer: `${base}/auth/v1`,
            audience: 'authenticated',
            hmacSecret: e.SUPABASE_JWT_SECRET,
            jwksUrl: `${base}/auth/v1/.well-known/jwks.json`,
        },
        moderators: new Set(csv(e.MODERATOR_AUTH_SUBJECTS)),
        avatarHosts: csv(e.AVATAR_HOSTS).map((h) => h.toLowerCase()),
        limits: { ...defaultLimits, ...overrides.limits },
    };
}
