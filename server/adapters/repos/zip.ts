import { and, eq, like, or } from 'drizzle-orm'
import { DirType } from '../../../shared/constants'
import { matters } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { Matter } from '../../services/matter'
import type {
  CollectCompressionPlanOptions,
  CompressionPlan,
  CompressionSourceDirectory,
  CompressionSourceFile,
  ZipPlanRepo,
} from '../../usecases/ports'
import { ZIP_COMPRESS_LIMITS } from '../../usecases/ports'

async function collectCompressionPlan(
  db: Database,
  orgId: string,
  matterIds: string[],
  opts: CollectCompressionPlanOptions = {},
): Promise<CompressionPlan> {
  const uniqueIds = [...new Set(matterIds)]
  if (uniqueIds.length > ZIP_COMPRESS_LIMITS.fileCount) {
    throw new Error(`Compression file count exceeds ${ZIP_COMPRESS_LIMITS.fileCount}`)
  }
  const roots = await db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), or(...uniqueIds.map((id) => eq(matters.id, id)))))
  if (roots.length !== uniqueIds.length) throw new Error('Some archive source IDs do not belong to this organization')
  if (roots.some((matter) => matter.status !== 'active')) throw new Error('Only active matters can be archived')

  const files: CompressionSourceFile[] = []
  const directories: CompressionSourceDirectory[] = []
  for (const root of roots) {
    const entries = await collectRootEntries(db, orgId, root)
    files.push(...entries.files)
    directories.push(...entries.directories)
  }
  validateCompressionEntries(files, directories)

  return {
    files,
    directories,
    inputBytes: files.reduce((sum, file) => sum + (file.matter.size ?? 0), 0),
    outputName: archiveOutputName(roots, opts.outputName),
    targetFolder: opts.targetFolder ?? roots[0].parent,
  }
}

function validateCompressionEntries(files: CompressionSourceFile[], directories: CompressionSourceDirectory[]): void {
  let totalBytes = 0
  const paths = new Set<string>()

  for (const directory of directories) {
    if (directoryDepth(directory.archivePath) > ZIP_COMPRESS_LIMITS.directoryDepth) {
      throw new Error(`Compression directory depth exceeds ${ZIP_COMPRESS_LIMITS.directoryDepth}`)
    }
    if (paths.has(directory.archivePath)) throw new Error(`Duplicate archive path: ${directory.archivePath}`)
    paths.add(directory.archivePath)
  }

  for (const file of files) {
    const bytes = file.matter.size ?? 0
    totalBytes += bytes
    if (bytes > ZIP_COMPRESS_LIMITS.singleFileBytes) {
      throw new Error(`Compression source file exceeds ${ZIP_COMPRESS_LIMITS.singleFileBytes} bytes`)
    }
    if (totalBytes > ZIP_COMPRESS_LIMITS.totalInputBytes) {
      throw new Error(`Compression input exceeds ${ZIP_COMPRESS_LIMITS.totalInputBytes} bytes`)
    }
    if (directoryDepth(file.archivePath) > ZIP_COMPRESS_LIMITS.directoryDepth) {
      throw new Error(`Compression directory depth exceeds ${ZIP_COMPRESS_LIMITS.directoryDepth}`)
    }
    if (paths.has(file.archivePath)) throw new Error(`Duplicate archive path: ${file.archivePath}`)
    paths.add(file.archivePath)
  }

  if (files.length > ZIP_COMPRESS_LIMITS.fileCount) {
    throw new Error(`Compression file count exceeds ${ZIP_COMPRESS_LIMITS.fileCount}`)
  }
}

async function collectRootEntries(
  db: Database,
  orgId: string,
  root: Matter,
): Promise<{ files: CompressionSourceFile[]; directories: CompressionSourceDirectory[] }> {
  if (root.dirtype === DirType.FILE) return { files: [{ matter: root, archivePath: root.name }], directories: [] }

  const rootPath = buildPath(root.parent, root.name)
  const rows = await db
    .select()
    .from(matters)
    .where(
      and(
        eq(matters.orgId, orgId),
        eq(matters.status, 'active'),
        or(eq(matters.parent, rootPath), like(matters.parent, `${rootPath}/%`)),
      ),
    )
  const directories = [
    { archivePath: relativeArchivePath(rootPath, root) },
    ...rows
      .filter((matter) => matter.dirtype !== DirType.FILE)
      .map((matter) => ({ archivePath: relativeArchivePath(rootPath, matter) })),
  ].sort(
    (a, b) =>
      directoryDepth(a.archivePath) - directoryDepth(b.archivePath) || a.archivePath.localeCompare(b.archivePath),
  )
  const files = rows
    .filter((matter) => matter.dirtype === DirType.FILE)
    .map((matter) => ({ matter, archivePath: relativeArchivePath(rootPath, matter) }))

  return { files, directories }
}

function relativeArchivePath(rootPath: string, matter: Matter): string {
  const path = buildPath(matter.parent, matter.name)
  const rootParent = rootPath.slice(0, Math.max(0, rootPath.lastIndexOf('/')))
  return rootParent ? path.slice(rootParent.length + 1) : path
}

function archiveOutputName(roots: Matter[], requestedName?: string): string {
  const name = requestedName ?? (roots.length === 1 ? `${baseZipName(roots[0].name)}.zip` : 'selection.zip')
  return name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`
}

function baseZipName(name: string): string {
  return name.toLowerCase().endsWith('.zip') ? name.slice(0, -4) : name
}

function directoryDepth(path: string): number {
  const parts = path.split('/').filter((part) => part.length > 0)
  return Math.max(0, parts.length - 1)
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function createZipPlanRepo(db: Database): ZipPlanRepo {
  return {
    collectCompressionPlan: (orgId, matterIds, opts) => collectCompressionPlan(db, orgId, matterIds, opts),
  }
}
