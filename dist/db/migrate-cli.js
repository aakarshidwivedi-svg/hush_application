import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
    console.error('Set DIRECT_URL (preferred) or DATABASE_URL before running migrations.');
    process.exit(1);
}
const pool = createPool(url, 2);
try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}
catch (err) {
    console.error(err.message);
    process.exitCode = 1;
}
finally {
    await pool.end();
}
