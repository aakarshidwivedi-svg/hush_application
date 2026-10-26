import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { blockUser, listBlocked, unblockUser } from './service.js';
import { devStore, isDbUnavailable } from '../../db/devStore.js';
const params = z.object({ userId: z.string().uuid() });
export function blocksRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    // Blocking must stay available to any live account, even one that is not yet fully eligible.
    const guard = [mw.authenticate, ctx.limit.safety, mw.loadUser, mw.requireActive];
    r.post('/users/:userId/block', ...guard, asyncHandler(async (req, res) => {
        const { userId } = params.parse(req.params);
        if (userId === req.user.id)
            throw new AppError(422, 'CANNOT_BLOCK_SELF', 'You cannot block yourself');
        try {
            await blockUser(ctx.pool, req.user, userId);
            ok(res, { status: 'blocked' });
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            devStore.blockUser(req.user, userId);
            ok(res, { status: 'blocked' });
        }
    }));
    r.delete('/users/:userId/block', ...guard, asyncHandler(async (req, res) => {
        const { userId } = params.parse(req.params);
        try {
            await unblockUser(ctx.pool, req.user, userId);
            ok(res, { status: 'unblocked' });
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            devStore.unblockUser(req.user, userId);
            ok(res, { status: 'unblocked' });
        }
    }));
    r.get('/blocks', mw.authenticate, mw.loadUser, mw.requireActive, asyncHandler(async (req, res) => {
        try {
            ok(res, await listBlocked(ctx.pool, req.user.id));
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            ok(res, devStore.listBlocked(req.user));
        }
    }));
    return r;
}
