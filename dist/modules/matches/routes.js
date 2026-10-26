import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { findActiveMatch, listMatches, unmatch } from './service.js';
import { devStore, isDbUnavailable } from '../../db/devStore.js';
export const matchParams = z.object({ matchId: z.string().uuid() });
export function matchesRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    const guard = [mw.authenticate, mw.loadUser, mw.requireEligible];
    r.get('/', ...guard, asyncHandler(async (req, res) => {
        try {
            ok(res, await listMatches(ctx.pool, req.user.id));
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            ok(res, devStore.getMatches(req.user));
        }
    }));
    r.get('/:matchId', ...guard, asyncHandler(async (req, res) => {
        const { matchId } = matchParams.parse(req.params);
        try {
            const match = await findActiveMatch(ctx.pool, matchId, req.user.id);
            if (!match)
                throw notFound('Match not found'); // same answer for "not yours", "unmatched" and "never existed"
            ok(res, match);
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            const match = devStore.getMatch(req.user, matchId);
            if (!match)
                throw notFound('Match not found');
            ok(res, match);
        }
    }));
    r.post('/:matchId/unmatch', mw.authenticate, ctx.limit.safety, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const { matchId } = matchParams.parse(req.params);
        try {
            await unmatch(ctx.pool, req.user.id, matchId);
            ok(res, { status: 'unmatched' });
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            devStore.unmatch(req.user, matchId);
            ok(res, { status: 'unmatched' });
        }
    }));
    return r;
}
