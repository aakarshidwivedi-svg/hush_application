-- Least-privilege grants for the API's database role.
--
-- Run AFTER the migrations, connected as the role that owns the tables (the "migrator").
-- Assumes the API role is called `hush_app`; change the name below if yours differs.
--
-- The role must be created once, by a role allowed to create roles:
--   CREATE ROLE hush_app LOGIN PASSWORD '<strong-password>' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
--
-- Why BYPASSRLS: migration 0001 enables Row Level Security on every table with NO policies, so
-- Supabase's browser-facing PostgREST roles (anon / authenticated) can read nothing directly.
-- The API is the only intended client and enforces authorisation itself, so it needs to bypass RLS.
-- It still cannot create, alter, drop or truncate anything.

GRANT USAGE ON SCHEMA public TO hush_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hush_app;
-- The migration bookkeeping table is for the migrator only.
REVOKE ALL ON TABLE schema_migrations FROM hush_app;

-- Tables created by future migrations (run by this same role) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hush_app;
