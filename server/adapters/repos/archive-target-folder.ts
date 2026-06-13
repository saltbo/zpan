import { and, eq } from 'drizzle-orm'
import { DirType } from '../../../shared/constants'
import { matters } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { ArchiveTargetFolderRepo } from '../../usecases/ports'

async function requireTargetFolder(db: Database, orgId: string, targetFolder: string): Promise<void> {
  if (targetFolder === '') return

  const slash = targetFolder.lastIndexOf('/')
  const parent = slash >= 0 ? targetFolder.slice(0, slash) : ''
  const name = slash >= 0 ? targetFolder.slice(slash + 1) : targetFolder
  const rows = await db
    .select()
    .from(matters)
    .where(
      and(eq(matters.orgId, orgId), eq(matters.parent, parent), eq(matters.name, name), eq(matters.status, 'active')),
    )
    .limit(1)
  const target = rows[0]
  if (!target) throw new Error('Target folder not found')
  if (target.dirtype === DirType.FILE) throw new Error('Target folder must be a folder')
}

export function createArchiveTargetFolderRepo(db: Database): ArchiveTargetFolderRepo {
  return {
    requireTargetFolder: (orgId, targetFolder) => requireTargetFolder(db, orgId, targetFolder),
  }
}
