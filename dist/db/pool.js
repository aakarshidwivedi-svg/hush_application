import pg from 'pg';
export function createPool(connectionString, max = 10) {
    const pool = new pg.Pool({ connectionString, max });
    // An idle client erroring must not crash the process; the pool discards it.
    pool.on('error', () => undefined);
    return pool;
}
const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
function isRetryable(err) {
    return typeof err === 'object' && err !== null && RETRYABLE.has(err.code ?? '');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Run `fn` inside a transaction (READ COMMITTED). Serialization failures and deadlocks are
 * retried with jittered backoff; everything else rolls back and rethrows.
 */
export async function withTx(pool, fn, retries = 4) {
    for (let attempt = 0;; attempt++) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                /* connection already broken; release below discards it */
            }
            if (attempt < retries && isRetryable(err)) {
                await sleep(10 * 2 ** attempt + Math.random() * 20);
                continue;
            }
            throw err;
        }
        finally {
            client.release();
        }
    }
}
/** Postgres error helpers. */
export function pgErrorCode(err) {
    return typeof err === 'object' && err !== null ? err.code : undefined;
}
export function pgConstraint(err) {
    return typeof err === 'object' && err !== null ? err.constraint : undefined;
}
