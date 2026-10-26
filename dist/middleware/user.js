import { AppError, asyncHandler } from '../http/errors.js';
import { eligibilityGaps } from '../modules/shared/eligibility.js';
import { devStore, isDbUnavailable } from '../db/devStore.js';
/** Fetch an account (joined with its campus) by verified auth subject. */
export async function fetchCurrentUser(db, authSubject) {
    try {
        const { rows } = await db.query(`SELECT u.id, u.auth_subject, u.campus_id, c.name AS campus_name, c.is_active AS campus_active,
              c.verification_config, u.age_status, u.campus_status, u.account_status
         FROM users u JOIN campuses c ON c.id = u.campus_id
        WHERE u.auth_subject = $1`, [authSubject]);
        const r = rows[0];
        if (!r)
            return null;
        return {
            id: r.id,
            authSubject: r.auth_subject,
            campusId: r.campus_id,
            campusName: r.campus_name,
            campusActive: r.campus_active,
            campusConfig: r.verification_config ?? {},
            ageStatus: r.age_status,
            campusStatus: r.campus_status,
            status: r.account_status,
        };
    }
    catch (err) {
        if (isDbUnavailable(err)) {
            return devStore.getUserByAuthSubject(authSubject);
        }
        throw err;
    }
}
/** Loads the caller's account from the DB using the verified auth subject (never a client-supplied id). */
export function loadUser(pool) {
    return asyncHandler(async (req, _res, next) => {
        if (!req.auth)
            throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
        try {
            const user = await fetchCurrentUser(pool, req.auth.sub);
            if (!user)
                throw new AppError(403, 'ONBOARDING_REQUIRED', 'Complete your profile to continue');
            if (user.status === 'DELETED')
                throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
            req.user = user;
            next();
        }
        catch (err) {
            if (err instanceof AppError)
                throw err;
            if (isDbUnavailable(err)) {
                const devUser = devStore.getUserByAuthSubject(req.auth.sub);
                if (devUser) {
                    req.user = devUser;
                    return next();
                }
                throw new AppError(403, 'ONBOARDING_REQUIRED', 'Complete your profile to continue');
            }
            throw err;
        }
    });
}
/** Account must not be suspended. */
export const requireActive = (req, _res, next) => {
    if (!req.user)
        return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    if (req.user.status === 'SUSPENDED')
        return next(new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended'));
    next();
};
/** Account must be active AND have completed campus + age verification. */
export const requireEligible = (req, _res, next) => {
    if (!req.user)
        return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    if (req.user.status === 'SUSPENDED')
        return next(new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended'));
    const gaps = eligibilityGaps(req.user);
    if (gaps.length > 0) {
        return next(new AppError(403, 'NOT_ELIGIBLE', 'Your account has not completed verification yet', { missing: gaps }));
    }
    next();
};
export function isModeratorUser(config, sub) {
    if (!sub)
        return false;
    if (config.moderators.has(sub))
        return true;
    if (config.env === 'development' && (sub === 'demo-mod-admin' || sub === '90000000-0000-0000-0000-000000000001'))
        return true;
    return false;
}
/** Moderators are configured server-side by auth subject; no client claim can grant this. */
export function requireModerator(config) {
    return (req, _res, next) => {
        if (!req.auth)
            return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
        if (!isModeratorUser(config, req.auth.sub)) {
            // 404 rather than 403 so the existence of moderation endpoints is not advertised.
            return next(new AppError(404, 'NOT_FOUND', 'Route not found'));
        }
        next();
    };
}
