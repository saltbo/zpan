// The subset of a storage row the S3 client needs. A StorageRecord structurally
// satisfies this, so callers pass storage records straight through.
export interface S3StorageCredentials {
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  customHost: string | null
}

export interface S3Gateway {
  presignUpload(
    storage: S3StorageCredentials,
    key: string,
    contentType: string,
    filenameOrExpiresIn?: string | number,
    expiresIn?: number,
  ): Promise<string>
  createMultipartUpload(storage: S3StorageCredentials, key: string, contentType: string): Promise<string>
  presignUploadPart(
    storage: S3StorageCredentials,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<string>
  completeMultipartUpload(
    storage: S3StorageCredentials,
    key: string,
    uploadId: string,
    parts: Array<{ etag: string; partNumber: number }>,
  ): Promise<void>
  abortMultipartUpload(storage: S3StorageCredentials, key: string, uploadId: string): Promise<void>
  presignDownload(storage: S3StorageCredentials, key: string, filename: string, expiresIn?: number): Promise<string>
  presignInline(storage: S3StorageCredentials, key: string, mime: string, expiresIn?: number): Promise<string>
  getPublicUrl(storage: S3StorageCredentials, key: string): string
  headObject(storage: S3StorageCredentials, key: string): Promise<{ size: number; contentType: string }>
  getObjectBytes(storage: S3StorageCredentials, key: string, range?: string): Promise<Uint8Array>
  getObjectBody(storage: S3StorageCredentials, key: string, range?: string): Promise<BodyInit>
  getObjectStream(storage: S3StorageCredentials, key: string, range?: string): Promise<ReadableStream<Uint8Array>>
  copyObject(
    srcStorage: S3StorageCredentials,
    srcKey: string,
    dstStorage: S3StorageCredentials,
    dstKey: string,
  ): Promise<void>
  streamCopy(
    srcStorage: S3StorageCredentials,
    srcKey: string,
    dstStorage: S3StorageCredentials,
    dstKey: string,
  ): Promise<void>
  putObject(
    storage: S3StorageCredentials,
    key: string,
    body: ReadableStream | Uint8Array,
    contentType: string,
    contentLength?: number,
  ): Promise<number>
  deleteObject(storage: S3StorageCredentials, key: string): Promise<void>
  deleteObjects(storage: S3StorageCredentials, keys: string[]): Promise<void>
}
