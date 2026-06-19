-- Trash is now tracked by `trashed_at`, not the `status` value.
-- Backfill existing trashed rows to status='active' (their trashed_at is already
-- set by the old trash() path), so they surface under /trash/objects.
UPDATE `matters` SET `status` = 'active' WHERE `status` = 'trashed';
--> statement-breakpoint
-- Swap the partial unique index: trashed rows are now status='active', so the
-- "one active name per parent" constraint must also exclude trashed rows
-- (trashed_at IS NOT NULL) or a restored/recreated name would collide with a
-- trashed sibling. Replaces migration 0009's `WHERE status = 'active'`.
DROP INDEX `matters_active_name_uniq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `matters_active_name_uniq`
  ON `matters` (`org_id`, `parent`, LOWER(`name`))
  WHERE `status` = 'active' AND `trashed_at` IS NULL;
