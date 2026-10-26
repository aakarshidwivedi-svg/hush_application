# Hush 🤫

An anonymous college dating app built around **mutual secret crushes**.
*"Someone might like you. You'll never know until it's mutual."*

Students create pseudonymous profiles, browse eligible people on their own campus, and send secret
crushes. Nothing is revealed unless both people crush on each other — then it's a match and they can chat.

| Layer | Tech |
| --- | --- |
| Client | React 18, Vite, TypeScript, Tailwind CSS, React Router |
| API | Node 20+, Express, TypeScript, Zod, `pg` (node-postgres) |
| Database | PostgreSQL 14+ — **plain SQL migrations are the source of truth** |
| Auth | Supabase Auth (email + password, email confirmation); the API verifies every token itself |
| Tests | Vitest + Supertest (real PostgreSQL), Playwright + axe (real browser, real API, real database) |

> **Why `pg` and not Prisma?** The first build environment couldn't download Prisma's query engine, so the
> data layer uses `pg` with hand-written SQL. Nothing else about the design changed. The matching engine
> relies on advisory locks and `ON CONFLICT`, which are written as explicit SQL either way.

## Repository layout

```
hush/
  client/                 React app (src/{components,pages,hooks,services,routes,types}), e2e/ (Playwright)
  server/
    migrations/           0001_init.sql … — applied in order, once each (tracked in schema_migrations)
    docs/db-grants.sql    least-privilege grants for the API's database role
    src/{config,middleware,db,http,lib}, src/modules/{auth,profiles,crushes,matches,messages,blocks,reports,account,notifications}
    tests/                Vitest integration tests (real PostgreSQL)
  docs/API.md             endpoint reference
  docs/SECURITY.md        security design + testing checklist
```

## Quick start (local)

Prerequisites: Node ≥ 20, PostgreSQL ≥ 14 (any local server), a Supabase project (free tier is fine).

```bash
npm install                                   # installs both workspaces

# 1. Database
createdb hush
cp server/.env.example server/.env            # then edit: DATABASE_URL, SUPABASE_URL, …
npm run db:migrate                            # applies server/migrations/*.sql

# 2. Add at least one campus (see "Campuses" below)
psql hush -c "INSERT INTO campuses (name, verification_config)
              VALUES ('Example University', '{\"emailDomains\":[\"example.edu\"]}')"

# 3. Client config
cp client/.env.example client/.env            # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL

# 4. Run
npm run dev:server                            # http://localhost:4000
npm run dev:client                            # http://localhost:5173
```

## Authentication & campus verification

### Supabase setup
1. Create a project. **Authentication → Providers → Email**: enable, and turn **Confirm email ON**.
2. **Authentication → URL Configuration**: set *Site URL* to your client origin and add
   `<client origin>/onboarding` to *Redirect URLs* (the confirmation link lands there).
3. Copy **Project URL** → `SUPABASE_URL` (server) / `VITE_SUPABASE_URL` (client) and the **anon public key** →
   `VITE_SUPABASE_ANON_KEY`. **Never** put the `service_role` key in the client; the API does not need it.
4. Token verification: new projects sign tokens with asymmetric keys, which the API verifies through the
   project's JWKS endpoint — set only `SUPABASE_URL`. Legacy projects that use a shared HS256 secret should also
   set `SUPABASE_JWT_SECRET`.

### How eligibility works
Eligibility is computed **on the server** and never taken from the client.

- **Campus**: during onboarding the API requires a *verified* email claim in the token and checks that the
  email's domain (or a subdomain) is in the chosen campus's `verification_config.emailDomains`. Success sets
  `campus_status = VERIFIED`.
- **Age**: onboarding records a self-attestation (`age_status = SELF_ATTESTED`). **A college email alone is not
  treated as proof of age or enrollment.** Campuses that need more set
  `"requireVerifiedAge": true`; those users stay out of Discover until a moderator marks them `VERIFIED` via
  `POST /moderation/users/:id/verify-age` (after whatever check you perform off-platform).
- Only `ACTIVE` accounts that are campus-verified, age-eligible, on an active campus, and `discoverable` are
  shown or can receive crushes.

### Campuses
```sql
INSERT INTO campuses (name, verification_config) VALUES
  ('Example University', '{"emailDomains":["example.edu"], "requireVerifiedAge": false}');
```

### Moderators
Set `MODERATOR_AUTH_SUBJECTS` to a comma-separated list of Supabase user ids (the `sub` of their tokens). Roles
are never read from the client or from token claims. Everyone else gets a plain 404 on `/moderation/*`.

## Database

- Schema lives in `server/migrations/*.sql` (never edit an applied file; add a new one).
- Constraints enforced **in the database**: no self-crush / self-match / self-block / self-report; unique
  `(sender, receiver)` crushes; matches stored in canonical order (`user_a < user_b`) with a unique pair; unique
  blocks; one live report per reporter+target; message length 1–1000; nickname format/uniqueness (case-insensitive).
- All tables have **Row Level Security enabled with no policies**, so Supabase's browser-facing roles can read
  nothing even if the project's REST API is exposed. Only the API's role can reach the data.

### Least-privilege database roles
Use two roles (names are examples):

```sql
-- as an admin:
CREATE ROLE hush_migrator LOGIN PASSWORD '…';                 -- owns the tables; used only to run migrations
CREATE ROLE hush_app LOGIN PASSWORD '…' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CREATE ON SCHEMA public TO hush_migrator;
```
Run migrations as `hush_migrator` (`DIRECT_URL`), then, still as `hush_migrator`:
`psql "$DIRECT_URL" -f server/docs/db-grants.sql`. Point `DATABASE_URL` at `hush_app`.
`hush_app` can read/write rows but cannot create, alter, drop or truncate anything (verified in the e2e run).
**`BYPASSRLS` is required** — without it every query returns nothing, because of the no-policy RLS above.

### Account deletion & data retention
`DELETE /api/v1/account` (body `{"confirm":"DELETE"}`) immediately erases the profile, all conversations the
person was in, crushes, notifications and blocks, and ends their matches. A bare tombstone row remains (internal
id, auth subject, campus, `DELETED`, timestamp) because safety reports must survive and the identity must not be
able to silently re-register. `npm run db:purge` (run it daily from a scheduler) deletes closed reports older than
**90 days** that involve deleted accounts, then tombstones with no remaining reports. Open reports block purging.
The Supabase Auth record is **not** removed by the API (it has no service-role key by design) — remove it from the
Supabase dashboard on request. The user-facing text is in `client/src/pages/Legal.tsx`.

## Configuration reference

Server (`server/.env`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | API connection (use the least-privilege `hush_app` role) |
| `DIRECT_URL` | Migrations/purge connection (falls back to `DATABASE_URL`) |
| `SUPABASE_URL` | Token issuer/JWKS (required) |
| `SUPABASE_JWT_SECRET` | Only for legacy HS256 projects |
| `CORS_ORIGINS` | Comma-separated approved browser origins |
| `MODERATOR_AUTH_SUBJECTS` | Moderator user ids |
| `AVATAR_HOSTS` | Optional allow-list of image hostnames (empty = any https host) |
| `TRUST_PROXY` | Reverse-proxy hops in front of the API, for correct per-IP limits |
| `PORT`, `LOG_LEVEL`, `DB_POOL_MAX`, `NODE_ENV` | Runtime |

Client (`client/.env`): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — public values only.

## Testing

```bash
npm run typecheck                        # both workspaces
npm run test:unit                        # fast unit tests (storage, image magic bytes, limits, schemas)
TEST_ADMIN_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm test          # API & database integration tests
E2E_ADMIN_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:e2e   # browser tests
```
Both suites create a throwaway database (`hush_test` / `hush_e2e`) on the PostgreSQL server you point them at —
use a superuser connection to a **disposable** server, never production. The first time, run
`npx playwright install chromium` (or set `PW_CHROMIUM_PATH` to an existing Chromium).

- **API tests** exercise the real SQL migrations on a real PostgreSQL: authorisation (IDOR, guessed ids),
  one-sided crushes revealing nothing, reciprocal match creation, **25× repeated simultaneous reciprocal crushes
  producing exactly one match**, an explicit "uncommitted opposite crush" race, block/unmatch/suspend/delete
  behaviour, rate limits, report restrictions, retention purge.
- **E2E tests** run the real client against the real API and database; only Supabase Auth is replaced by a test
  session signed with the API's HS256 secret (the API verifies it exactly like a real token). They cover onboarding,
  discovery privacy, the full crush → match → chat → block → delete journey, focus-trapped dialogs, mobile layout,
  reduced motion, and axe WCAG A/AA audits.

## Deployment

**Database (Supabase Postgres).** Create the two roles above, run `npm run db:migrate:prod` with `DIRECT_URL`
(the *direct* connection), then apply `server/docs/db-grants.sql`. Use the *pooled* connection string for `DATABASE_URL`.

**API (any Node host: Render, Fly.io, Railway, a VM…).**
`npm ci && npm run build --workspace server` → start with `node server/dist/index.js`. Set the server env vars above
(`NODE_ENV=production`, `CORS_ORIGINS` = your client origin, `TRUST_PROXY=1` behind one proxy). Run
`npm run db:migrate:prod --workspace server` as a release step and `npm run db:purge:prod --workspace server` daily.
Rate limiting is in-memory: with more than one API instance, put a shared store (e.g. Redis) behind it.
Terminate TLS at the platform; the API sends HSTS and other secure headers via `helmet`.

**Client (Vercel).** Project root `client/`, build `npm run build`, output `dist`. Set the three `VITE_*` variables.
`client/vercel.json` provides the SPA rewrite and basic headers.

Pre-launch: replace `CONTACT_EMAIL` in `client/src/pages/Legal.tsx`, and **have counsel review the Terms,
Privacy Policy and Guidelines** — they are drafts that describe what this code actually does.

## Completed Features & Architecture Upgrades

### 1. Admin Moderation Dashboard (`/moderation`)
- Responsive moderation UI accessible to authorized moderators.
- Filter user reports by status (`OPEN`, `REVIEWING`, `ACTIONED`, `DISMISSED`), category (`HARASSMENT`, `SPAM`, `FAKE_PROFILE`, `INAPPROPRIATE_CONTENT`, `UNDERAGE`, `OTHER`), and date order.
- Action reports with auditable resolution notes (`PATCH /moderation/reports/:id`).
- Account-level safety actions with confirmation dialogs: suspend account, reinstate account, and verify age.
- Strictly enforced server-side security boundary via `requireModerator` (checks authenticated subject against `MODERATOR_AUTH_SUBJECTS`).

### 2. Real-Time Messaging (`socket.io` + `socket.io-client`)
- Full real-time messaging replacing 4-second polling.
- Handshake token authentication verified using Supabase JWT verifiers.
- Conversation authorization enforced on room join (`match:${matchId}`) and on every message dispatch.
- Real-time typing indicators (`typing` event with partner indicator animation).
- Dual delivery support: fast Socket.IO message send with automatic REST endpoint fallback (`POST /matches/:id/messages`), guaranteeing delivery even over restricted networks.
- Graceful in-memory handling with documented single-node vs clustered adapter considerations (Socket.IO Redis adapter recommended for multi-instance scaling).

### 3. Smarter Interest-Based Profile Recommendations
- Transparent recommendation engine ranking eligible campus profiles by shared interests (`shared_count DESC`).
- Clear match explanations (e.g. `"✨ You both enjoy Pop & Coffee"` or `"🎓 Fellow student at Stanford"`).
- Deterministic pseudo-random tie-breaking per viewer (`md5(viewerId:candidateId)`).
- **Core Secret Crush Privacy Preserved**: Recommendation scoring logic strictly avoids factoring in whether a candidate has liked the viewer, ensuring one-sided crushes are never leaked.
- GIN indexed `interests` on `profiles` (migration `0006_notifications_and_recommendations.sql`).

### 4. Reliable In-App Notifications
- In-app notification bell with live unread badge counter in the navigation header.
- Dropdown inbox supporting both mutual matches (`MATCH`) and incoming messages (`MESSAGE`).
- Mark single notification as read or bulk mark all as read (`POST /notifications/read`).
- Real-time Socket.IO notification push directly to `user:${userId}` room.

---

## Known limitations & considerations

- **Single-instance Socket.IO**: The current real-time implementation runs in-memory. For horizontal scaling across multiple load-balanced server instances, attach `@socket.io/redis-adapter`.
- **Browser Push Notifications**: In-app notifications and real-time badges are fully operational; Web Push / APNS push notifications can be integrated as a future background service.
- **Age verification is self-attestation plus an optional manual moderator step**: Automated government ID checking (e.g. Persona/Stripe Identity) is not yet integrated.
- **Phase 8 (anonymous confession wall) is intentionally deferred** until campus moderation tooling is battle-tested.
