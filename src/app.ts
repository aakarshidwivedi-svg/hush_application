import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Pool } from 'pg';
import type { Config } from './config/env.js';
import { createCtx } from './context.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { limiter } from './middleware/rateLimit.js';
import type { TokenVerifier } from './middleware/auth.js';
import { accountRouter } from './modules/account/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { blocksRouter } from './modules/blocks/routes.js';
import { crushesRouter } from './modules/crushes/routes.js';
import { confessionsRouter } from './modules/confessions/routes.js';
import { communitiesRouter } from './modules/communities/routes.js';
import { friendshipsRouter } from './modules/friendships/routes.js';
import { interestsRouter } from './modules/interests/routes.js';
import { matchesRouter } from './modules/matches/routes.js';
import { messagesRouter } from './modules/messages/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { profilesRouter } from './modules/profiles/routes.js';
import { reportsRouter } from './modules/reports/routes.js';

export interface AppDeps {
  pool: Pool;
  config: Config;
  logger?: Logger;
  /** Override token verification (tests). Production uses the Supabase-configured verifier. */
  verify?: TokenVerifier;
}

export function createApp({ pool, config, logger, verify }: AppDeps): Express {
  const log =
    logger ??
    pino({
      level: config.env === 'test' ? 'silent' : config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    });
  const ctx = createCtx(pool, config, verify);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Request ID tracing for auditability and debugging
  app.use((req, res, next) => {
    const rawId = req.headers['x-request-id'];
    const reqId = typeof rawId === 'string' && rawId.trim() ? rawId.trim().slice(0, 64) : randomUUID();
    (req as { id?: string }).id = reqId;
    res.setHeader('x-request-id', reqId);
    next();
  });

  // Secure logging: method, path (no query string), status, requestId. Never bodies, tokens or message text.
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => (req as { id?: string }).id || randomUUID(),
      serializers: {
        req: (req: { method: string; url: string; id?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(limiter(config.limits.global, 'global'));

  app.get('/', (_req, res) => {
    res.redirect(config.corsOrigins[0] ?? 'http://localhost:5173');
  });

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });
  api.use(authRouter(ctx)); // GET /campuses, POST /auth/complete-profile
  api.use('/interests', interestsRouter(ctx)); // GET /interests
  api.use('/profiles', profilesRouter(ctx));
  api.use('/crushes', crushesRouter(ctx));
  api.use('/friends', friendshipsRouter(ctx));
  api.use('/communities', communitiesRouter(ctx));
  api.use('/confessions', confessionsRouter(ctx));
  api.use('/matches', matchesRouter(ctx));
  api.use('/matches', messagesRouter(ctx));
  api.use('/notifications', notificationsRouter(ctx));
  api.use(blocksRouter(ctx)); // POST/DELETE /users/:id/block, GET /blocks
  api.use(reportsRouter(ctx)); // POST /reports, /moderation/* (moderators only)
  api.use(accountRouter(ctx)); // DELETE /account
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
