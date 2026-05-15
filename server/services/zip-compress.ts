import { and, eq, like, or } from 'drizzle-orm'
import { Zip, ZipDeflate, ZipPassThrough, type Zippable, zipSync } from 'fflate'
import { DirType } from '../../shared/constants'
import { matters } from '../db/schema'
import type { Database } from '../platform/interface'
import type { Matter } from './matter'

export const ZIP_COMPRESS_LIMITS = {
  totalInputBytes: 512 * 1024 * 1024,
  singleFileBytes: 512 * 1024 * 1024,
  fileCount: 1000,
  directoryDepth: 10,
} as const

export interface CompressionSourceFile {
  matter: Matter
  archivePath: string
}

export interface CompressionSourceDirectory {
  archivePath: string
}

export interface ZipSourceObject {
  archivePath: string
  bytes: Uint8Array
}

export interface ZipSourceStream {
  archivePath: string
  openStream: () => Promise<ReadableStream<Uint8Array>>
}

export interface CompressionPlan {
  files: CompressionSourceFile[]
  directories: CompressionSourceDirectory[]
  inputBytes: number
  outputName: string
  targetFolder: string
}

export async function collectCompressionPlan(
  db: Database,
  orgId: string,
  matterIds: string[],
  opts: { targetFolder?: string; outputName?: string } = {},
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

export function createZipArchive(
  objects: ZipSourceObject[],
  directories: CompressionSourceDirectory[] = [],
): Uint8Array {
  const zippable: Zippable = {}
  for (const directory of directories) zippable[`${directory.archivePath}/`] = new Uint8Array()
  for (const object of objects) zippable[object.archivePath] = object.bytes
  return zipSync(zippable, { level: 6 })
}

export function createZipArchiveStream(
  sources: ZipSourceStream[],
  directories: CompressionSourceDirectory[] = [],
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip()
      zip.ondata = (error, chunk, final) => {
        if (error) {
          controller.error(error)
          return
        }
        if (chunk) controller.enqueue(new Uint8Array(chunk))
        if (final) controller.close()
      }

      void streamZipEntries(zip, sources, directories, async () => {}).catch((error) => {
        zip.terminate()
        controller.error(error)
      })
    },
  })
}

async function streamZipEntries(
  zip: Zip,
  sources: ZipSourceStream[],
  directories: CompressionSourceDirectory[],
  waitForWrites: () => Promise<void>,
): Promise<void> {
  for (const directory of directories) {
    const entry = new ZipPassThrough(`${directory.archivePath}/`)
    zip.add(entry)
    entry.push(new Uint8Array(), true)
    await waitForWrites()
  }

  for (const source of sources) {
    const entry = new ZipDeflate(source.archivePath, { level: 6 })
    zip.add(entry)
    await pushStreamToZipEntry(await source.openStream(), entry, waitForWrites)
  }

  zip.end()
}

async function pushStreamToZipEntry(
  stream: ReadableStream<Uint8Array>,
  entry: ZipDeflate,
  waitForWrites: () => Promise<void>,
): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      entry.push(new Uint8Array(), true)
      await waitForWrites()
      return
    }
    entry.push(value, false)
    await waitForWrites()
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
