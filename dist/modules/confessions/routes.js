import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { createConfessionSchema, listConfessionsQuerySchema, moderateConfessionSchema, reportConfessionSchema, } from './schemas.js';
import { createConfession, getCampusConfessions, getModerationConfessions, moderateConfession, reportConfession, toggleConfessionLike, } from './service.js';
const idParam = z.object({ id: z.string().uuid() });
export function confessionsRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    // 1. List campus confessions (student feed)
    r.get('/', mw.authenticate, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const q = listConfessionsQuerySchema.parse(req.query);
        const confessions = await getCampusConfessions(ctx.pool, req.user, q.category, q.limit);
        ok(res, confessions);
    }));
    // 2. Submit new anonymous confession (rate-limited, sanitized)
    r.post('/', mw.authenticate, ctx.limit.safety, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const input = createConfessionSchema.parse(req.body);
        const created = await createConfession(ctx.pool, req.user, input);
        ok(res, created, 201);
    }));
    // 3. Toggle like / heart reaction
    r.post('/:id/like', mw.authenticate, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const { id } = idParam.parse(req.params);
        const result = await toggleConfessionLike(ctx.pool, req.user, id);
        ok(res, result);
    }));
    // 4. Report confession for harassment / doxxing
    r.post('/:id/report', mw.authenticate, ctx.limit.report, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const { id } = idParam.parse(req.params);
        const input = reportConfessionSchema.parse(req.body);
        const result = await reportConfession(ctx.pool, req.user, id, input);
        ok(res, result);
    }));
    // 5. Moderation routes (restricted to authenticated moderators only)
    const mod = [mw.authenticate, mw.requireModerator, ctx.limit.safety];
    r.get('/moderation/list', ...mod, asyncHandler(async (req, res) => {
        const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
        const list = await getModerationConfessions(ctx.pool, statusFilter);
        ok(res, list);
    }));
    r.patch('/moderation/:id', ...mod, asyncHandler(async (req, res) => {
        const { id } = idParam.parse(req.params);
        const input = moderateConfessionSchema.parse(req.body);
        const result = await moderateConfession(ctx.pool, req.auth.sub, id, input);
        ok(res, result);
    }));
    return r;
}
