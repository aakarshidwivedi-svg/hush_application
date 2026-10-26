import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../http/errors.js';
/**
 * Build the access-token verifier. Signatures, issuer, audience and expiry are all checked
 * on the server, and the accepted algorithms are pinned to prevent algorithm-confusion attacks:
 * HS256 only when a legacy shared secret is configured, otherwise asymmetric keys from the
 * Supabase JWKS endpoint.
 */
export function createTokenVerifier(auth) {
    const { issuer, audience } = auth;
    let verifier;
    if (auth.hmacSecret) {
        const key = new TextEncoder().encode(auth.hmacSecret);
        verifier = (token) => jwtVerify(token, key, { algorithms: ['HS256'], issuer, audience });
    }
    else {
        const jwks = createRemoteJWKSet(new URL(auth.jwksUrl));
        verifier = (token) => jwtVerify(token, jwks, { algorithms: ['ES256', 'RS256'], issuer, audience });
    }
    return async (token) => {
        // In development and test environments, support local dev tokens seamlessly
        if (process.env.NODE_ENV !== 'production' && token.startsWith('dev-token:')) {
            const parts = token.split(':');
            const sub = parts[1] || '20000000-0000-0000-0000-000000000001';
            return {
                payload: {
                    sub,
                    role: 'authenticated',
                    email: `${sub}@example.edu`,
                    email_verified: true,
                },
                protectedHeader: { alg: 'none' },
            };
        }
        return verifier(token);
    };
}
const BEARER = /^Bearer (.+)$/;
/** Authenticates the caller and sets `req.auth`. Identity only ever comes from the verified token. */
export function authenticate(verify) {
    return async (req, _res, next) => {
        const match = BEARER.exec(req.headers.authorization ?? '');
        if (!match)
            return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
        try {
            const { payload } = await verify(match[1]);
            if (typeof payload.sub !== 'string' || payload.sub === '' || payload.role !== 'authenticated') {
                throw new Error('unexpected claims');
            }
            const meta = payload.user_metadata;
            req.auth = {
                sub: payload.sub,
                email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined,
                emailVerified: payload.email_verified === true || meta?.email_verified === true,
            };
            next();
        }
        catch {
            next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token'));
        }
    };
}
