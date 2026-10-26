import { Router } from 'express';
import { asyncHandler } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { listActiveInterests } from './service.js';
export function interestsRouter(ctx) {
    const r = Router();
    /**
     * Public list of canonical active interests grouped by category.
     * Can be accessed during onboarding or by authenticated users.
     */
    r.get('/', asyncHandler(async (_req, res) => {
        try {
            const interests = await listActiveInterests(ctx.pool);
            ok(res, interests);
        }
        catch (err) {
            const { CANONICAL_INTERESTS } = await import('../../lib/canonicalInterests.js');
            ok(res, CANONICAL_INTERESTS);
        }
    }));
    return r;
}
