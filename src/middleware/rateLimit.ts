import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimit } from '../config/env.js';

/**
 * Fixed-window limiter. Keyed by the verified auth subject when available (so one user cannot
 * burn another's quota and shared campus NATs are not punished), falling back to the client IP.
 * The in-memory store is per-process; use a shared store (e.g. Redis) behind multiple instances.
 */
export function limiter(rl: RateLimit, keyPrefix: string): RequestHandler {
  return rateLimit({
    windowMs: rl.windowMs,
    limit: rl.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${keyPrefix}:${req.auth?.sub ?? req.ip ?? 'unknown'}`,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });
    },
  });
}
