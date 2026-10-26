-- 0004: pin the search_path of the deleted_at trigger function (Supabase linter: function_search_path_mutable).
-- Additive only; 0003 is never edited after being applied. Idempotent.

ALTER FUNCTION "users_sync_deleted_at"() SET search_path = public;
