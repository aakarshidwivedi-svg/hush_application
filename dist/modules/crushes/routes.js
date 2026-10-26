import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { sendCrush, withdrawCrush } from './service.js';
import { devStore, isDbUnavailable } from '../../db/devStore.js';
const params = z.object({ userId: z.string().uuid() });
export function crushesRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    const guard = [mw.authenticate, ctx.limit.crush, mw.loadUser, mw.requireEligible];
    // There is deliberately no GET/list endpoint: crush records are write-only for clients.
    r.post('/:userId', ...guard, asyncHandler(async (req, res) => {
        const { userId } = params.parse(req.params);
        const sender = req.user; // sender identity comes only from the verified token
        if (userId === sender.id)
            throw new AppError(422, 'CANNOT_CRUSH_SELF', 'You cannot send a crush to yourself');
        try {
            await sendCrush(ctx.pool, sender, userId);
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            devStore.sendCrush(sender, userId);
        }
        // Identical for one-sided interest, a new match, a repeat, or a silently-ignored crush.
        ok(res, { status: 'sent' });
    }));
    r.delete('/:userId', ...guard, asyncHandler(async (req, res) => {
        const { userId } = params.parse(req.params);
        try {
            await withdrawCrush(ctx.pool, req.user, userId);
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            devStore.withdrawCrush(req.user, userId);
        }
        ok(res, { status: 'withdrawn' });
    }));
    return r;
}
