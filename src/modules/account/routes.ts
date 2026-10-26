import { Router } from 'express';
import type { Ctx } from '../../context.js';
import { asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { deleteAccount, deleteAccountSchema } from './service.js';
import { devStore, isDbUnavailable } from '../../db/devStore.js';

export function accountRouter(ctx: Ctx): Router {
  const r = Router();
  const { mw } = ctx;

  // Deliberately available to suspended accounts too: people can always leave.
  r.delete(
    '/account',
    mw.authenticate,
    ctx.limit.safety,
    mw.loadUser,
    asyncHandler(async (req, res) => {
      deleteAccountSchema.parse(req.body);
      try {
        await deleteAccount(ctx.pool, req.user!.id);
      } catch (err) {
        if (!isDbUnavailable(err)) throw err;
        devStore.deleteAccount(req.user!.id);
      }
      ok(res, { status: 'deleted' });
    }),
  );

  return r;
}
