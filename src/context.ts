import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { Config } from './config/env.js';
import { authenticate, createTokenVerifier, type TokenVerifier } from './middleware/auth.js';
import { limiter } from './middleware/rateLimit.js';
import { loadUser, requireActive, requireEligible, requireModerator } from './middleware/user.js';

/** Shared dependencies handed to every module router. */
export interface Ctx {
  pool: Pool;
  config: Config;
  mw: {
    authenticate: RequestHandler;
    loadUser: RequestHandler;
    requireActive: RequestHandler;
    requireEligible: RequestHandler;
    requireModerator: RequestHandler;
  };
  limit: {
    auth: RequestHandler;
    crush: RequestHandler;
    message: RequestHandler;
    report: RequestHandler;
    safety: RequestHandler;
  };
}

export function createCtx(pool: Pool, config: Config, verify: TokenVerifier = createTokenVerifier(config.auth)): Ctx {
  return {
    pool,
    config,
    mw: {
      authenticate: authenticate(verify),
      loadUser: loadUser(pool),
      requireActive,
      requireEligible,
      requireModerator: requireModerator(config),
    },
    limit: {
      auth: limiter(config.limits.auth, 'auth'),
      crush: limiter(config.limits.crush, 'crush'),
      message: limiter(config.limits.message, 'message'),
      report: limiter(config.limits.report, 'report'),
      safety: limiter(config.limits.safety, 'safety'),
    },
  };
}
