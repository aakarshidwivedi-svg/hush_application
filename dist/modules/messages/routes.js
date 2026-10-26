import { Router } from 'express';
import { asyncHandler } from '../../http/errors.js';
import { ok, okPage } from '../../http/respond.js';
import { matchParams } from '../matches/routes.js';
import { listMessages, listMessagesQuerySchema, sendMessage, sendMessageSchema } from './service.js';
import { devStore, isDbUnavailable } from '../../db/devStore.js';
import { emitRealtimeMessage } from '../../realtime/socket.js';
/** Mounted under /matches so the paths are /matches/:matchId/messages. */
export function messagesRouter(ctx) {
    const r = Router();
    const { mw } = ctx;
    r.get('/:matchId/messages', mw.authenticate, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const { matchId } = matchParams.parse(req.params);
        const q = listMessagesQuerySchema.parse(req.query);
        try {
            const { messages, nextCursor } = await listMessages(ctx.pool, req.user.id, matchId, q);
            okPage(res, messages, { nextCursor });
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            const page = devStore.getMessages(req.user, matchId, q);
            okPage(res, page.messages, { nextCursor: page.nextCursor });
        }
    }));
    r.post('/:matchId/messages', mw.authenticate, ctx.limit.message, mw.loadUser, mw.requireEligible, asyncHandler(async (req, res) => {
        const { matchId } = matchParams.parse(req.params);
        const { content } = sendMessageSchema.parse(req.body);
        try {
            const msg = await sendMessage(ctx.pool, req.user.id, matchId, content);
            emitRealtimeMessage(matchId, req.user.id, msg);
            ok(res, msg, 201);
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            const msg = devStore.sendMessage(req.user, matchId, content);
            emitRealtimeMessage(matchId, req.user.id, msg);
            ok(res, msg, 201);
        }
    }));
    return r;
}
