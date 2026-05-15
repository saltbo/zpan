import { Unzip, UnzipInflate, unzipSync } from 'fflate'

export const ZIP_EXTRACT_LIMITS = {
  totalOutputBytes: 1024 * 1024 * 1024,
  singleFileBytes: 1024 * 1024 * 1024,
  fileCount: 1000,
  directoryDepth: 10,
} as const

export interface ExtractedZipEntry {
  path: string
  name: string
  parentPath: string
  bytes: Uint8Array
  size: number
}

interface CentralDirectoryEntry {
  name: string
  flags: number
  compression: number
  compressedSize: number
  uncompressedSize: number
  externalAttributes: number
}

export interface ZipDirectoryPlan {
  folders: string[]
  totalBytes: number
  fileCount: number
}

export interface ValidatedZip {
  files: ExtractedZipEntry[]
  folders: string[]
  totalBytes: number
}

export interface StreamingZipFile {
  path: string
  name: string
  parentPath: string
  stream: ReadableStream<Uint8Array>
  size: Promise<number>
}

export interface StreamingZipExtraction {
  folders: string[]
  totalBytes: number
}

const textDecoder = new TextDecoder()

export function validateAndExtractZip(data: Uint8Array): ValidatedZip {
  const entries = readCentralDirectory(data)
  validateEntries(entries)

  const fileNames = new Set(entries.filter((entry) => !isDirectoryEntry(entry)).map((entry) => entry.name))
  const unzipped = unzipSync(data, { filter: (file) => fileNames.has(file.name) })
  const folders = collectFolders(entries)
  const files = Object.entries(unzipped).map(([path, bytes]) => {
    const parts = pathParts(path)
    return {
      path,
      name: parts[parts.length - 1],
      parentPath: parts.slice(0, -1).join('/'),
      bytes,
      size: bytes.length,
    }
  })

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > ZIP_EXTRACT_LIMITS.totalOutputBytes) {
    throw new Error(`ZIP extraction output exceeds ${ZIP_EXTRACT_LIMITS.totalOutputBytes} bytes`)
  }

  return { files, folders, totalBytes }
}

export async function validateZipDirectory(
  size: number,
  readRange: (start: number, end: number) => Promise<Uint8Array>,
): Promise<ZipDirectoryPlan> {
  const tailLength = Math.min(size, 65557)
  const tailOffset = size - tailLength
  const tail = await readRange(tailOffset, size - 1)
  const eocd = findEndOfCentralDirectory(tail)
  const entryCount = uint16(tail, eocd + 10)
  const centralDirectorySize = uint32(tail, eocd + 12)
  const centralDirectoryOffset = uint32(tail, eocd + 16)
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported')
  }

  const centralDirectory = await readRange(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize - 1)
  const entries = readCentralDirectoryEntries(centralDirectory, entryCount)
  validateEntries(entries)

  return {
    folders: collectFolders(entries),
    totalBytes: totalEntryBytes(entries),
    fileCount: entries.filter((entry) => !isDirectoryEntry(entry)).length,
  }
}

export async function streamValidatedZip(
  data: ReadableStream<Uint8Array>,
  onFile: (file: StreamingZipFile) => Promise<void>,
): Promise<StreamingZipExtraction> {
  const folders = new Set<string>()
  const tasks: Promise<void>[] = []
  let fileCount = 0
  let totalBytes = 0

  const unzip = new Unzip((file) => {
    validatePath(file.name)
    if (file.compression !== 0 && file.compression !== 8) throw new Error('ZIP contains unsupported compression method')
    const directory = file.name.endsWith('/')
    const depth = directoryDepth(file.name, directory)
    if (depth > ZIP_EXTRACT_LIMITS.directoryDepth) {
      throw new Error(`ZIP directory depth exceeds ${ZIP_EXTRACT_LIMITS.directoryDepth}`)
    }
    collectPathFolders(file.name, directory, folders)

    if (directory) {
      file.start()
      return
    }

    fileCount += 1
    if (fileCount > ZIP_EXTRACT_LIMITS.fileCount) {
      throw new Error(`ZIP file count exceeds ${ZIP_EXTRACT_LIMITS.fileCount}`)
    }
    if (file.originalSize !== undefined && file.originalSize > ZIP_EXTRACT_LIMITS.singleFileBytes) {
      throw new Error(`ZIP entry exceeds ${ZIP_EXTRACT_LIMITS.singleFileBytes} bytes`)
    }

    const parts = pathParts(file.name)
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    const writer = stream.writable.getWriter()
    let writes = Promise.resolve()
    let size = 0
    let resolveSize: (value: number) => void
    let rejectSize: (error: unknown) => void
    const sizePromise = new Promise<number>((resolve, reject) => {
      resolveSize = resolve
      rejectSize = reject
    })

    file.ondata = (error, chunk, final) => {
      if (error) {
        writes = writes.then(() => writer.abort(error))
        rejectSize(error)
        return
      }
      if (chunk) {
        size += chunk.byteLength
        totalBytes += chunk.byteLength
        if (size > ZIP_EXTRACT_LIMITS.singleFileBytes) {
          const err = new Error(`ZIP entry exceeds ${ZIP_EXTRACT_LIMITS.singleFileBytes} bytes`)
          writes = writes.then(() => writer.abort(err))
          rejectSize(err)
          return
        }
        if (totalBytes > ZIP_EXTRACT_LIMITS.totalOutputBytes) {
          const err = new Error(`ZIP extraction output exceeds ${ZIP_EXTRACT_LIMITS.totalOutputBytes} bytes`)
          writes = writes.then(() => writer.abort(err))
          rejectSize(err)
          return
        }
        writes = writes.then(() => writer.write(chunk))
      }
      if (final) {
        writes = writes.then(() => writer.close()).then(() => resolveSize(size))
      }
    }

    const zipFile: StreamingZipFile = {
      path: file.name,
      name: parts[parts.length - 1],
      parentPath: parts.slice(0, -1).join('/'),
      stream: stream.readable,
      size: sizePromise,
    }
    tasks.push(onFile(zipFile))
    file.start()
  })
  unzip.register(UnzipInflate)

  const reader = data.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    unzip.push(value, false)
  }
  unzip.push(new Uint8Array(), true)
  const results = await Promise.allSettled(tasks)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason

  return {
    folders: [...folders].sort((a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b)),
    totalBytes,
  }
}

function validateEntries(entries: CentralDirectoryEntry[]): void {
  let fileCount = 0
  let totalBytes = 0

  for (const entry of entries) {
    validatePath(entry.name)
    if ((entry.flags & 1) === 1) throw new Error('Encrypted ZIP archives are not supported')
    if (isUnsupportedUnixType(entry.externalAttributes)) throw new Error('ZIP contains unsupported entry type')
    if (entry.compression !== 0 && entry.compression !== 8)
      throw new Error('ZIP contains unsupported compression method')

    const directory = isDirectoryEntry(entry)
    const depth = directoryDepth(entry.name, directory)
    if (depth > ZIP_EXTRACT_LIMITS.directoryDepth) {
      throw new Error(`ZIP directory depth exceeds ${ZIP_EXTRACT_LIMITS.directoryDepth}`)
    }

    if (!directory) {
      fileCount += 1
      totalBytes += entry.uncompressedSize
      if (entry.uncompressedSize > ZIP_EXTRACT_LIMITS.singleFileBytes) {
        throw new Error(`ZIP entry exceeds ${ZIP_EXTRACT_LIMITS.singleFileBytes} bytes`)
      }
      if (fileCount > ZIP_EXTRACT_LIMITS.fileCount) {
        throw new Error(`ZIP file count exceeds ${ZIP_EXTRACT_LIMITS.fileCount}`)
      }
      if (totalBytes > ZIP_EXTRACT_LIMITS.totalOutputBytes) {
        throw new Error(`ZIP extraction output exceeds ${ZIP_EXTRACT_LIMITS.totalOutputBytes} bytes`)
      }
    }
  }
}

function readCentralDirectory(data: Uint8Array): CentralDirectoryEntry[] {
  const eocd = findEndOfCentralDirectory(data)
  const entryCount = uint16(data, eocd + 10)
  const offset = uint32(data, eocd + 16)
  return readCentralDirectoryEntries(data, entryCount, offset)
}

function readCentralDirectoryEntries(data: Uint8Array, entryCount: number, startOffset = 0): CentralDirectoryEntry[] {
  let offset = startOffset
  const entries: CentralDirectoryEntry[] = []

  for (let i = 0; i < entryCount; i += 1) {
    if (uint32(data, offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory')

    const flags = uint16(data, offset + 8)
    const compression = uint16(data, offset + 10)
    const compressedSize = uint32(data, offset + 20)
    const uncompressedSize = uint32(data, offset + 24)
    const nameLength = uint16(data, offset + 28)
    const extraLength = uint16(data, offset + 30)
    const commentLength = uint16(data, offset + 32)
    const externalAttributes = uint32(data, offset + 38)
    const nameStart = offset + 46
    const name = textDecoder.decode(data.subarray(nameStart, nameStart + nameLength))
    entries.push({ name, flags, compression, compressedSize, uncompressedSize, externalAttributes })
    offset = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

function totalEntryBytes(entries: CentralDirectoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + (isDirectoryEntry(entry) ? 0 : entry.uncompressedSize), 0)
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const minOffset = Math.max(0, data.length - 65557)
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (uint32(data, offset) === 0x06054b50) return offset
  }
  throw new Error('Invalid ZIP archive')
}

function collectFolders(entries: CentralDirectoryEntry[]): string[] {
  const folders = new Set<string>()
  for (const entry of entries) {
    collectPathFolders(entry.name, isDirectoryEntry(entry), folders)
  }
  return [...folders].sort((a, b) => pathParts(a).length - pathParts(b).length || a.localeCompare(b))
}

function collectPathFolders(path: string, directory: boolean, folders: Set<string>): void {
  const parts = pathParts(path)
  const max = directory ? parts.length : parts.length - 1
  for (let i = 1; i <= max; i += 1) folders.add(parts.slice(0, i).join('/'))
}

function validatePath(path: string): void {
  if (path.length === 0) throw new Error('ZIP contains an empty path')
  if (path.includes('\\')) throw new Error('ZIP paths must use forward slashes')
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new Error('ZIP contains an absolute path')
  }
  const parts = path.split('/')
  const lastIndex = parts.length - 1
  if (parts.some((part, index) => part.length === 0 && index !== lastIndex)) {
    throw new Error('ZIP contains an empty path segment')
  }
  if (parts.length === 0) throw new Error('ZIP contains an empty path')
  if (parts.some((part) => part === '..')) throw new Error('ZIP paths cannot contain ..')
}

function isDirectoryEntry(entry: CentralDirectoryEntry): boolean {
  return entry.name.endsWith('/')
}

function isUnsupportedUnixType(externalAttributes: number): boolean {
  const mode = externalAttributes >>> 16
  const type = mode & 0o170000
  return type !== 0 && type !== 0o100000 && type !== 0o040000
}

function directoryDepth(path: string, directory: boolean): number {
  const parts = pathParts(path)
  return directory ? parts.length : Math.max(0, parts.length - 1)
}

function pathParts(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0)
}

function uint16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function uint32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}
