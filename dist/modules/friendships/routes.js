import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { respondFriendRequestSchema } from './schemas.js';
import { listConnections, listFriendRequests, removeConnection, respondFriendRequest, sendFriendRequest, } from './service.js';
const targetParam = z.object({ targetId: z.string().uuid() });
const requestParam = z.object({ id: z.string().uuid() });
export function friendshipsRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    const guard = [mw.authenticate, mw.loadUser, mw.requireEligible];
    // 1. Send explicit campus friend request
    r.post('/request/:targetId', ...guard, ctx.limit.crush, // reuse rate limiting for peer interactions
    asyncHandler(async (req, res) => {
        const { targetId } = targetParam.parse(req.params);
        const result = await sendFriendRequest(ctx.pool, req.user, targetId);
        ok(res, result, 201);
    }));
    // 2. List incoming pending friend requests
    r.get('/requests', ...guard, asyncHandler(async (req, res) => {
        const requests = await listFriendRequests(ctx.pool, req.user);
        ok(res, requests);
    }));
    // 3. Respond (ACCEPT or DECLINE) to a friend request
    r.post('/requests/:id/respond', ...guard, asyncHandler(async (req, res) => {
        const { id } = requestParam.parse(req.params);
        const body = respondFriendRequestSchema.parse(req.body);
        const result = await respondFriendRequest(ctx.pool, req.user, id, body);
        ok(res, result);
    }));
    // 4. List connected campus friends
    r.get('/', ...guard, asyncHandler(async (req, res) => {
        const friends = await listConnections(ctx.pool, req.user);
        ok(res, friends);
    }));
    // 5. Remove friend / disconnect
    r.delete('/:targetId', ...guard, asyncHandler(async (req, res) => {
        const { targetId } = targetParam.parse(req.params);
        const result = await removeConnection(ctx.pool, req.user, targetId);
        ok(res, result);
    }));
    return r;
}
