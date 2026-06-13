import type { Platform } from '../../platform/interface'

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]
export const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MiB

export type ImageUploadResult = { ok: true; url: string } | { ok: false; status: 400 | 413 | 503; error: string }

// Stream-proxy public images (avatars, org logos) to the workspace's public
// image backend: an R2 binding on CF (zero-auth, zero-egress) or the
// user-configured public S3 storage everywhere else. The platform is passed
// per call because the R2 binding + public-URL env are request-scoped.
export interface ImageUpload {
  uploadPublicImage(platform: Platform, prefix: string, id: string, file: File): Promise<ImageUploadResult>
  deletePublicImageVariants(platform: Platform, prefix: string, id: string): Promise<void>
}
