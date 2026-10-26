import { authenticate, createTokenVerifier } from './middleware/auth.js';
import { limiter } from './middleware/rateLimit.js';
import { loadUser, requireActive, requireEligible, requireModerator } from './middleware/user.js';
export function createCtx(pool, config, verify = createTokenVerifier(config.auth)) {
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
