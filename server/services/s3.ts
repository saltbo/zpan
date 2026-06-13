// Transitional re-export: S3Service now lives in adapters/gateways. Deleted when
// the last http importer (objects/webdav/ihost/share-utils) moves to deps.s3.
export { S3Service } from '../adapters/gateways/s3'
export type { S3StorageCredentials } from '../usecases/ports'
