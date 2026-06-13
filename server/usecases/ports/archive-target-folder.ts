// Validates that an explicit archive target folder exists and is a folder (not a
// file). Owned by its own repo so the archive-processing usecase never touches
// the matters table directly — the only genuinely-new persistence the archive
// orchestration needs beyond the matter service / zip plan repo.
export interface ArchiveTargetFolderRepo {
  // Throws 'Target folder not found' when no active matter matches the path, or
  // 'Target folder must be a folder' when it resolves to a file. An empty path
  // (the workspace root) is always valid.
  requireTargetFolder(orgId: string, targetFolder: string): Promise<void>
}
