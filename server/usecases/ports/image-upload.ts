import type { Platform } from '../../platform/interface'
import {
  type AppError,
  badRequest,
  externalError,
  forbidden,
  internalError,
  noStorage,
  payloadTooLarge,
} from './app-error'

// User avatars (`AVATAR_PREFIX`) and team/org logos (`LOGO_PREFIX`) are hosted on
// the ZPan Cloud avatar service. The prefix the usecase passes encodes which one
// it is; the gateway maps it to the Cloud avatar scope (`user` / `team`).
export const AVATAR_PREFIX = '_system/avatars'
export const LOGO_PREFIX = '_system/org-logos'

// Cloud-hosting outcome. A failure carries the HTTP status the http layer renders:
//   400 unsupported image type · 413 too large · 403 license inactive ·
//   500 unexpected cloud error · 503 instance not paired to Cloud (cloud_required).
export type ImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 403 | 413 | 500 | 503; error: string }

const IMAGE_UPLOAD_FAILURES = {
  400: badRequest,
  403: forbidden,
  413: payloadTooLarge,
  500: internalError,
  503: noStorage,
} satisfies Record<Extract<ImageUploadResult, { ok: false }>['status'], (message: never) => AppError>

/** The API error for a failed upload; the gateway's code stays in the server log. */
export function imageUploadError(failure: Extract<ImageUploadResult, { ok: false }>): AppError {
  return externalError(IMAGE_UPLOAD_FAILURES[failure.status], failure.error, 'Image upload failed')
}

// Upload/delete public images (avatars, org logos) via the Cloud avatar service.
// `platform` is passed per call because the active license binding + cloud base
// URL are request-scoped. Validation (mime/size) and Cloud error mapping live in
// the gateway; the unbound instance surfaces as `{ status: 503, 'cloud_required' }`.
export interface ImageUpload {
  uploadPublicImage(platform: Platform, prefix: string, id: string, file: File): Promise<ImageUploadResult>
  deletePublicImageVariants(platform: Platform, prefix: string, id: string): Promise<void>
}
