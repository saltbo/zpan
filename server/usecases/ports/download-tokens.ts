import type { Database, Platform } from '../../platform/interface'

export const DOWNLOAD_TOKEN_VERSION = 1

export interface DownloaderTokenClaims {
  v: typeof DOWNLOAD_TOKEN_VERSION
  typ: 'downloader'
  downloaderId: string
  jti: string
  iat: number
}

export interface TaskUploadTokenClaims {
  v: typeof DOWNLOAD_TOKEN_VERSION
  typ: 'download-task-upload'
  taskId: string
  downloaderId: string
  orgId: string
  targetFolder: string
  createdByUserId: string
  scopes: string[]
  jti: string
  iat: number
  exp: number
}

export type DownloadTokenClaims = DownloaderTokenClaims | TaskUploadTokenClaims

// Signed, HMAC-backed download tokens. Crypto + the secret come from the
// platform per call; the resolve* methods cross-check the signed claims against
// the downloader/task rows. The secret is derived from BETTER_AUTH_SECRET (or
// DOWNLOAD_TOKEN_SECRET) and the gateway throws if neither is set.
export interface DownloadTokenGateway {
  signDownloadToken(platform: Platform, claims: DownloadTokenClaims): Promise<string>
  verifyDownloadToken(platform: Platform, token: string): Promise<DownloadTokenClaims | null>
  hashDownloadToken(platform: Platform, token: string): Promise<string>
  resolveDownloaderToken(platform: Platform, token: string): Promise<{ downloaderId: string } | null>
  resolveTaskUploadToken(db: Database, platform: Platform, token: string): Promise<TaskUploadTokenClaims | null>
}
