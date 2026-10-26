import pg from 'pg';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client erroring must not crash the process; the pool discards it.
  pool.on('error', () => undefined);
  return pool;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

function isRetryable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && RETRYABLE.has((err as { code?: string }).code ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` inside a transaction (READ COMMITTED). Serialization failures and deadlocks are
 * retried with jittered backoff; everything else rolls back and rethrows.
 */
export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken; release below discards it */
      }
      if (attempt < retries && isRetryable(err)) {
        await sleep(10 * 2 ** attempt + Math.random() * 20);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Postgres error helpers. */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}
export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { constraint?: string }).constraint : undefined;
}
