import { eq, inArray } from 'drizzle-orm'
// Shared type has uid field absent from DB schema — same mismatch as image-upload.ts.
// Both use `as unknown as S3Storage` to bridge them. The fields used by S3Service
// (endpoint, region, accessKey, secretKey, bucket, customHost) exist on both.
import type { Storage as S3Storage } from '../../shared/types'
import { systemOptions } from '../db/schema'
import type { Database, Platform } from '../platform/interface'
import { S3Service } from './s3'
import { selectStorage } from './storage'

const s3 = new S3Service()

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
const FAVICON_MIMES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'] as const
export const MAX_BRANDING_FILE_SIZE = 2 * 1024 * 1024 // 2 MiB

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

export const BRANDING_KEYS = {
  logo: 'branding_logo_url',
  favicon: 'branding_favicon_url',
  wordmark_text: 'branding_wordmark_text',
  hide_powered_by: 'branding_hide_powered_by',
} as const

export type BrandingUploadResult = { ok: true; url: string } | { ok: false; status: 400 | 413 | 503; error: string }

export async function readBranding(db: Database) {
  const keys = Object.values(BRANDING_KEYS)
  const rows = await db.select().from(systemOptions).where(inArray(systemOptions.key, keys))
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    logo_url: map.get(BRANDING_KEYS.logo) ?? null,
    favicon_url: map.get(BRANDING_KEYS.favicon) ?? null,
    wordmark_text: map.get(BRANDING_KEYS.wordmark_text) ?? null,
    hide_powered_by: map.get(BRANDING_KEYS.hide_powered_by) === 'true',
  }
}

export async function uploadBrandingImage(
  platform: Platform,
  field: 'logo' | 'favicon',
  file: File,
): Promise<BrandingUploadResult> {
  const allowedMimes = field === 'logo' ? LOGO_MIMES : FAVICON_MIMES
  if (!(allowedMimes as readonly string[]).includes(file.type)) {
    return { ok: false, status: 400, error: `Invalid file type for ${field}. Allowed: ${allowedMimes.join(', ')}` }
  }
  if (file.size > MAX_BRANDING_FILE_SIZE) {
    return { ok: false, status: 413, error: 'File too large. Max 2 MiB.' }
  }

  let storage: S3Storage
  try {
    storage = (await selectStorage(platform.db, 'public')) as unknown as S3Storage
  } catch {
    return { ok: false, status: 503, error: 'No public storage configured' }
  }

  const ext = MIME_TO_EXT[file.type] ?? 'bin'
  const key = `_system/branding/${field}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  await s3.putObject(storage, key, bytes, file.type)
  const url = s3.getPublicUrl(storage, key)

  await upsertOption(platform.db, BRANDING_KEYS[field], url)
  return { ok: true, url }
}

export async function setBrandingField(
  db: Database,
  field: 'wordmark_text' | 'hide_powered_by',
  value: string,
): Promise<void> {
  await upsertOption(db, BRANDING_KEYS[field], value)
}

export async function resetBrandingField(db: Database, field: keyof typeof BRANDING_KEYS): Promise<void> {
  await db.delete(systemOptions).where(eq(systemOptions.key, BRANDING_KEYS[field]))
}

async function upsertOption(db: Database, key: string, value: string): Promise<void> {
  await db
    .insert(systemOptions)
    .values({ key, value, public: true })
    .onConflictDoUpdate({ target: systemOptions.key, set: { value, public: true } })
}
