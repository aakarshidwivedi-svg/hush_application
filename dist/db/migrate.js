import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** server/migrations — resolved relative to this file for both src/ (tsx) and dist/ (node). */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
const LOCK_KEY = 727274; // arbitrary constant: serialises concurrent migrators
/**
 * Apply every `NNNN_name.sql` in order, once, each inside its own transaction.
 * The SQL files are the source of truth for the schema.
 */
export async function runMigrations(pool, dir = MIGRATIONS_DIR) {
    const client = await pool.connect();
    const applied = [];
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`);
        const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
        const files = (await fs.readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
        for (const file of files) {
            if (done.has(file))
                continue;
            const sql = await fs.readFile(path.join(dir, file), 'utf8');
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
            }
            catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${file} failed: ${err.message}`);
            }
            applied.push(file);
        }
    }
    finally {
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
        }
        catch {
            /* ignore */
        }
        client.release();
    }
    return applied;
}
