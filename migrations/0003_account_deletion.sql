-- 0003: account deletion tombstones. Additive only.
--
-- Deleting an account erases the profile, conversations, crushes, notifications and blocks.
-- The `users` row stays as a bare tombstone (id, auth_subject, campus, status) because
-- reports reference users with ON DELETE RESTRICT (safety records must survive), and because
-- keeping the auth subject stops a deleted/suspended identity from silently re-registering.
-- Tombstones are purged after the retention period once no open report references them.

ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- Keep `deleted_at` consistent with `account_status` however the status is changed.
CREATE FUNCTION "users_sync_deleted_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account_status" = 'DELETED' THEN
    NEW."deleted_at" := COALESCE(NEW."deleted_at", now());
  ELSE
    NEW."deleted_at" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "users_sync_deleted_at_trg" BEFORE INSERT OR UPDATE OF "account_status", "deleted_at" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_sync_deleted_at"();
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at") WHERE "deleted_at" IS NOT NULL;

-- At most one live report per reporter+target, so repeat reports cannot flood moderators.
CREATE UNIQUE INDEX "reports_one_live_per_pair_idx" ON "reports"("reporter_id", "target_id")
  WHERE "status" IN ('OPEN', 'REVIEWING');
