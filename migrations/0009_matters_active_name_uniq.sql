-- Enforce case-insensitive uniqueness of active items within the same parent.
-- Draft and trashed rows are excluded so concurrent uploads and the recycle bin
-- can keep duplicates by name without violating the constraint.
CREATE UNIQUE INDEX `matters_active_name_uniq`
  ON `matters` (`org_id`, `parent`, LOWER(`name`))
  WHERE `status` = 'active';
