export const ZIP_COMPRESS_LIMITS = {
  totalInputBytes: 512 * 1024 * 1024,
  singleFileBytes: 512 * 1024 * 1024,
  fileCount: 1000,
  directoryDepth: 10,
} as const

export const ZIP_EXTRACT_LIMITS = {
  totalOutputBytes: 1024 * 1024 * 1024,
  singleFileBytes: 1024 * 1024 * 1024,
  fileCount: 1000,
  directoryDepth: 10,
} as const

// The matter fields the compression plan needs to stream a source object. A
// drizzle matter row structurally satisfies this, so the repo passes rows straight
// through without leaking the persistence row type into the port.
export interface CompressionSourceMatter {
  storageId: string
  object: string
  size: number | null
}

export interface CompressionSourceFile {
  matter: CompressionSourceMatter
  archivePath: string
}

export interface CompressionSourceDirectory {
  archivePath: string
}

export interface CompressionPlan {
  files: CompressionSourceFile[]
  directories: CompressionSourceDirectory[]
  inputBytes: number
  outputName: string
  targetFolder: string
}

export interface CollectCompressionPlanOptions {
  targetFolder?: string
  outputName?: string
}

export interface ZipPlanRepo {
  collectCompressionPlan(
    orgId: string,
    matterIds: string[],
    opts?: CollectCompressionPlanOptions,
  ): Promise<CompressionPlan>
}

export interface ZipSourceObject {
  archivePath: string
  bytes: Uint8Array
}

export interface ZipSourceStream {
  archivePath: string
  openStream: () => Promise<ReadableStream<Uint8Array>>
}

export interface ExtractedZipEntry {
  path: string
  name: string
  parentPath: string
  bytes: Uint8Array
  size: number
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

export interface ZipGateway {
  createZipArchive(objects: ZipSourceObject[], directories?: CompressionSourceDirectory[]): Uint8Array
  createZipArchiveStream(
    sources: ZipSourceStream[],
    directories?: CompressionSourceDirectory[],
  ): ReadableStream<Uint8Array>
  validateAndExtractZip(data: Uint8Array): ValidatedZip
  validateZipDirectory(
    size: number,
    readRange: (start: number, end: number) => Promise<Uint8Array>,
  ): Promise<ZipDirectoryPlan>
  streamValidatedZip(
    data: ReadableStream<Uint8Array>,
    onFile: (file: StreamingZipFile) => Promise<void>,
  ): Promise<StreamingZipExtraction>
}
