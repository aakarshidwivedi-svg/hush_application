import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { ADMIN_URL, TEST_DB_NAME, testDbUrl } from './helpers.js';

/** Creates a fresh `hush_test` database and applies the real SQL migrations to it. */
export default async function setup(): Promise<void> {
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    throw new Error(
      `Cannot reach PostgreSQL at ${ADMIN_URL} (${(err as Error).message}). ` +
        'Start a local PostgreSQL or set TEST_ADMIN_DATABASE_URL to a superuser connection string.',
    );
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ connectionString: testDbUrl(), max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
