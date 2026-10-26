import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack e2e: real React client → real Express API → real PostgreSQL.
 * Only Supabase Auth is replaced: tests inject a session signed with the API's HS256 test secret,
 * which the API verifies exactly as it verifies a Supabase token.
 */
export const E2E = {
  adminUrl: process.env.E2E_ADMIN_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres',
  dbName: 'hush_e2e',
  jwtSecret: 'e2e-secret-e2e-secret-e2e-secret-123',
  supabaseUrl: 'http://localhost:54321',
  apiPort: 4010,
  clientPort: 4173,
};

const dbUrl = (() => {
  const u = new URL(E2E.adminUrl);
  u.pathname = `/${E2E.dbName}`;
  return u.toString();
})();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E.clientPort}`,
    trace: 'retain-on-failure',
    // Optional: point at an already-installed Chromium instead of Playwright's own download.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx ../server/src/index.ts',
      url: `http://localhost:${E2E.apiPort}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        PORT: String(E2E.apiPort),
        // The API may run as a restricted role (E2E_APP_DATABASE_URL); migrations always use the owner.
        DATABASE_URL: process.env.E2E_APP_DATABASE_URL ?? dbUrl,
        SUPABASE_URL: E2E.supabaseUrl,
        SUPABASE_JWT_SECRET: E2E.jwtSecret,
        CORS_ORIGINS: `http://localhost:${E2E.clientPort}`,
        MODERATOR_AUTH_SUBJECTS: '00000000-0000-4000-8000-00000000aaaa',
      },
    },
    {
      command: `npx vite --port ${E2E.clientPort} --strictPort`,
      url: `http://localhost:${E2E.clientPort}`,
      reuseExistingServer: false,
      env: {
        VITE_API_URL: `http://localhost:${E2E.apiPort}/api/v1`,
        VITE_SUPABASE_URL: E2E.supabaseUrl,
        VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      },
    },
  ],
});
