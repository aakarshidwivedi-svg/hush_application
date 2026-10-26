import { Router } from 'express';
import { pgConstraint, pgErrorCode, withTx } from '../../db/pool.js';
import { asyncHandler, conflict, forbidden, validation } from '../../http/errors.js';
import { ok } from '../../http/respond.js';
import { fetchCurrentUser } from '../../middleware/user.js';
import { completeProfileSchema } from '../profiles/schemas.js';
import { assertAvatarAllowed, getProfileRow, toMe } from '../profiles/service.js';
import { emailMatchesCampus } from '../shared/eligibility.js';
import { listUserPhotos } from '../photos/service.js';
import { parseImagePayload, savePhotoFile } from '../photos/storage.js';
import { devStore, devToMe, isDbUnavailable } from '../../db/devStore.js';
export function authRouter(ctx) {
    const r = Router();
    const { mw, pool } = ctx;
    /** Public list of campuses so the sign-up form can offer a choice. */
    r.get('/campuses', asyncHandler(async (_req, res) => {
        try {
            const { rows } = await pool.query('SELECT id, name, verification_config FROM campuses WHERE is_active ORDER BY name');
            ok(res, rows.map((c) => ({ id: c.id, name: c.name, emailDomains: c.verification_config?.emailDomains ?? [] })));
        }
        catch (err) {
            // Fallback demo campuses so UI is previewable when local Postgres is not yet connected
            ok(res, [
                { id: '11111111-1111-1111-1111-111111111111', name: 'Example University', emailDomains: ['example.edu', 'uni.edu'] },
                { id: '22222222-2222-2222-2222-222222222222', name: 'Stanford University', emailDomains: ['stanford.edu'] },
                { id: '33333333-3333-3333-3333-333333333333', name: 'UC Berkeley', emailDomains: ['berkeley.edu'] },
                { id: '44444444-4444-4444-4444-444444444444', name: 'MIT', emailDomains: ['mit.edu'] },
            ]);
        }
    }));
    /**
     * Onboarding. Campus status is derived on the server from the *verified* email claim in the
     * token and the campus configuration — never from client input. Age is self-attested here;
     * campuses that set `requireVerifiedAge` keep the account ineligible until a moderator
     * upgrades it to VERIFIED. A college email alone is not treated as proof of age.
     */
    r.post('/auth/complete-profile', mw.authenticate, ctx.limit.auth, asyncHandler(async (req, res) => {
        const auth = req.auth;
        const input = completeProfileSchema.parse(req.body);
        assertAvatarAllowed(ctx.config, input.avatarUrl);
        let campus;
        try {
            const { rows } = await pool.query('SELECT verification_config FROM campuses WHERE id = $1 AND is_active', [input.campusId]);
            campus = rows[0];
        }
        catch (err) {
            if (!isDbUnavailable(err))
                throw err;
            campus = { verification_config: { emailDomains: [] } };
        }
        if (ctx.config.env === 'production') {
            if (!campus)
                throw validation('Unknown or inactive campus');
            if (!auth.emailVerified)
                throw forbidden('EMAIL_NOT_VERIFIED', 'Please verify your email address first');
            if (!emailMatchesCampus(auth.email, campus.verification_config ?? {})) {
                throw forbidden('CAMPUS_EMAIL_MISMATCH', 'Sign up with an email address issued by your campus');
            }
        }
        // Pre-validate interest IDs if provided
        let interestNames = input.interests;
        if (input.interestIds && input.interestIds.length > 0) {
            const uniqueInterestIds = Array.from(new Set(input.interestIds));
            try {
                const { rows: validInterests } = await pool.query('SELECT id, name FROM interests WHERE id = ANY($1) AND is_active = true', [uniqueInterestIds]);
                if (validInterests.length > 0) {
                    interestNames = validInterests.map((i) => i.name);
                }
            }
            catch (err) {
                if (!isDbUnavailable(err))
                    throw err;
                const { CANONICAL_INTERESTS } = await import('../../lib/canonicalInterests.js');
                interestNames = CANONICAL_INTERESTS.filter((i) => uniqueInterestIds.includes(i.id)).map((i) => i.name);
            }
        }
        // Pre-process and validate photos if provided
        const parsedPhotos = (input.photos ?? []).map((p, idx) => {
            const { buffer, mimeType } = parseImagePayload(p.image, p.contentType);
            const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
            const isPrimary = p.isPrimary ?? (idx === 0);
            return { buffer, ext, isPrimary, displayOrder: idx };
        });
        let savedDevResult = null;
        try {
            await withTx(pool, async (c) => {
                const u = await c.query(`INSERT INTO users (auth_subject, campus_id, age_status, campus_status)
             VALUES ($1, $2, 'SELF_ATTESTED', 'VERIFIED') RETURNING id`, [auth.sub, input.campusId]);
                const userId = u.rows[0].id;
                let avatarUrl = input.avatarUrl;
                // Save photos if provided
                if (parsedPhotos.length > 0) {
                    for (const p of parsedPhotos) {
                        const storagePath = await savePhotoFile(userId, p.buffer, p.ext);
                        const { rows: photoRows } = await c.query(`INSERT INTO profile_photos (user_id, storage_path, display_order, is_primary)
                 VALUES ($1, $2, $3, $4) RETURNING id`, [userId, storagePath, p.displayOrder, p.isPrimary]);
                        if (p.isPrimary) {
                            avatarUrl = `/api/v1/profiles/photos/${photoRows[0].id}`;
                        }
                    }
                }
                await c.query(`INSERT INTO profiles (user_id, nickname, nickname_key, bio, interests, avatar_url, discoverable)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`, [userId, input.nickname, input.nickname.toLowerCase(), input.bio, interestNames, avatarUrl, input.discoverable]);
                // Save user_interests if provided
                if (input.interestIds && input.interestIds.length > 0) {
                    const uniqueInterestIds = Array.from(new Set(input.interestIds));
                    for (const interestId of uniqueInterestIds) {
                        await c.query('INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)', [userId, interestId]);
                    }
                }
            });
        }
        catch (err) {
            if (pgErrorCode(err) === '23505') {
                const constraint = pgConstraint(err);
                if (constraint === 'users_auth_subject_key')
                    throw conflict('ALREADY_ONBOARDED', 'Your profile is already set up');
                if (constraint === 'profiles_nickname_key_key')
                    throw conflict('NICKNAME_TAKEN', 'That nickname is already taken');
            }
            if (isDbUnavailable(err)) {
                const uploadedPhotoRecords = [];
                for (const p of parsedPhotos) {
                    const storagePath = await savePhotoFile('dev-user', p.buffer, p.ext);
                    uploadedPhotoRecords.push({ storagePath, isPrimary: p.isPrimary });
                }
                savedDevResult = devStore.saveProfile(auth.sub, input.campusId, input.nickname, input.bio, interestNames, input.avatarUrl, input.discoverable, uploadedPhotoRecords);
            }
            else {
                throw err;
            }
        }
        if (savedDevResult) {
            return ok(res, devToMe(savedDevResult.user, savedDevResult.profile, savedDevResult.photos), 201);
        }
        const user = (await fetchCurrentUser(pool, auth.sub));
        const profile = (await getProfileRow(pool, user.id));
        const photos = await listUserPhotos(pool, user.id);
        ok(res, toMe(user, profile, photos), 201);
    }));
    // Fast developer / reviewer login in non-production environments
    if (ctx.config.env !== 'production') {
        r.post('/auth/dev-login', asyncHandler(async (req, res) => {
            const body = req.body;
            const isMod = body?.role === 'moderator';
            const sub = isMod ? 'demo-mod-admin' : '20000000-0000-0000-0000-000000000001';
            const token = `dev-token:${sub}:authenticated`;
            let user = devStore.getUserByAuthSubject(sub);
            if (!user) {
                const created = devStore.saveProfile(sub, '11111111-1111-1111-1111-111111111111', isMod ? 'Campus Moderator' : 'Maya Sharma', isMod ? 'Official campus safety moderator' : 'CS sophomore obsessed with indie music, iced matcha, and late night debug sessions 🎧☕', ['Pop', 'Coffee', 'Indie', 'Anime'], null, true, []);
                user = created.user;
            }
            const prof = devStore.getProfile(user.id);
            const photos = devStore.getPhotos(user.id);
            const me = devToMe(user, prof, photos, isMod);
            ok(res, { token, user: me });
        }));
    }
    return r;
}
