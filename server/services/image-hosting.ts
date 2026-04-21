import { and, asc, eq, gt, isNotNull, like, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { AllowedImageMime } from '../../shared/schemas'
import type { ImageHosting } from '../../shared/types'
import { imageHostingConfigs, imageHostings, orgQuotas, storages } from '../db/schema'
import type { Database } from '../platform/interface'

// ── Token-based redirect helpers (used by /r/:token route) ───────────────────

export interface ImageResolution {
  image: ImageHosting
  refererAllowlist: string[]
}

export async function resolveActiveImageByToken(db: Database, token: string): Promise<ImageResolution | null> {
  const rows = await db.select().from(imageHostings).where(eq(imageHostings.token, token)).limit(1)
  if (rows.length === 0) return null

  const row = rows[0]
  if (row.status !== 'active') return null

  const configRows = await db
    .select()
    .from(imageHostingConfigs)
    .where(eq(imageHostingConfigs.orgId, row.orgId))
    .limit(1)

  const config = configRows[0] ?? null
  const refererAllowlist = config?.refererAllowlist ? (JSON.parse(config.refererAllowlist) as string[]) : []

  return {
    image: row as unknown as ImageHosting,
    refererAllowlist,
  }
}

export async function resolveCustomDomain(db: Database, host: string): Promise<string | null> {
  const rows = await db
    .select({ orgId: imageHostingConfigs.orgId })
    .from(imageHostingConfigs)
    .where(and(eq(imageHostingConfigs.customDomain, host), isNotNull(imageHostingConfigs.domainVerifiedAt)))
    .limit(1)
  return rows[0]?.orgId ?? null
}

export async function getImageByOrgPath(db: Database, orgId: string, path: string): Promise<ImageHosting | null> {
  const rows = await db
    .select()
    .from(imageHostings)
    .where(and(eq(imageHostings.orgId, orgId), eq(imageHostings.path, path), eq(imageHostings.status, 'active')))
    .limit(1)
  if (rows.length === 0) return null
  return rows[0] as unknown as ImageHosting
}

export async function incrementAccessCount(db: Database, id: string): Promise<void> {
  await db.run(
    sql`UPDATE image_hostings SET access_count = access_count + 1, last_accessed_at = ${Date.now()} WHERE id = ${id}`,
  )
}

// ── CRUD service types and helpers ────────────────────────────────────────────

export type ImageHostingRow = typeof imageHostings.$inferSelect
export type ImageHostingConfigRow = typeof imageHostingConfigs.$inferSelect

const PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/
const MAX_DEPTH = 5
const MAX_PATH_LENGTH = 256
const MAX_COLLISION_RETRIES = 5

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime as AllowedImageMime] ?? 'bin'
}

export type PathValidationError = { error: 'invalid path'; detail: string }

export function validatePath(path: string): PathValidationError | null {
  if (!PATH_PATTERN.test(path)) {
    return { error: 'invalid path', detail: 'path contains invalid characters' }
  }
  if (path.startsWith('/')) {
    return { error: 'invalid path', detail: 'path must not start with /' }
  }
  if (path.endsWith('/')) {
    return { error: 'invalid path', detail: 'path must not end with /' }
  }
  if (path.includes('..')) {
    return { error: 'invalid path', detail: 'path must not contain ..' }
  }
  if (path.includes('//')) {
    return { error: 'invalid path', detail: 'path must not contain //' }
  }
  if (path.length > MAX_PATH_LENGTH) {
    return { error: 'invalid path', detail: `path exceeds ${MAX_PATH_LENGTH} characters` }
  }
  const depth = path.split('/').length
  if (depth > MAX_DEPTH) {
    return { error: 'invalid path', detail: `path depth exceeds ${MAX_DEPTH} segments` }
  }
  return null
}

function splitStemExt(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return { stem: filename, ext: '' }
  return { stem: filename.slice(0, dot), ext: filename.slice(dot) }
}

function randomHex4(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
}

async function resolveUniquePath(db: Database, orgId: string, requestedPath: string): Promise<string> {
  const rows = await db
    .select({ path: imageHostings.path })
    .from(imageHostings)
    .where(and(eq(imageHostings.orgId, orgId), eq(imageHostings.path, requestedPath)))

  if (rows.length === 0) return requestedPath

  const slashIdx = requestedPath.lastIndexOf('/')
  const basename = slashIdx >= 0 ? requestedPath.slice(slashIdx + 1) : requestedPath
  const prefix = slashIdx >= 0 ? requestedPath.slice(0, slashIdx + 1) : ''
  const { stem, ext } = splitStemExt(basename)

  for (let i = 0; i < MAX_COLLISION_RETRIES; i++) {
    const candidate = `${prefix}${stem}-${randomHex4()}${ext}`
    const conflict = await db
      .select({ path: imageHostings.path })
      .from(imageHostings)
      .where(and(eq(imageHostings.orgId, orgId), eq(imageHostings.path, candidate)))
    if (conflict.length === 0) return candidate
  }

  // Exhausted retries — use nanoid suffix as fallback
  return `${prefix}${stem}-${nanoid(4)}${ext}`
}

export async function getImageHostingConfig(db: Database, orgId: string): Promise<ImageHostingConfigRow | null> {
  const rows = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId))
  return rows[0] ?? null
}

export interface CreateImageInput {
  orgId: string
  path: string
  mime: AllowedImageMime
  size: number
  storageId: string
  status: 'draft' | 'active'
}

export async function createImageHosting(db: Database, input: CreateImageInput): Promise<ImageHostingRow> {
  const id = nanoid(12)
  const token = `ih_${nanoid(10)}`
  const ext = mimeToExt(input.mime)
  const storageKey = `ih/${input.orgId}/${id}.${ext}`
  const now = new Date()

  const resolvedPath = await resolveUniquePath(db, input.orgId, input.path)

  const row: ImageHostingRow = {
    id,
    orgId: input.orgId,
    token,
    path: resolvedPath,
    storageId: input.storageId,
    storageKey,
    size: input.size,
    mime: input.mime,
    width: null,
    height: null,
    status: input.status,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: now,
  }

  await db.insert(imageHostings).values(row)
  return row
}

export async function getImageHosting(db: Database, id: string, orgId: string): Promise<ImageHostingRow | null> {
  const rows = await db
    .select()
    .from(imageHostings)
    .where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId)))
  return rows[0] ?? null
}

export interface ListImagesOptions {
  pathPrefix?: string
  cursor?: string
  limit: number
}

export async function listImageHostings(
  db: Database,
  orgId: string,
  opts: ListImagesOptions,
): Promise<{ items: ImageHostingRow[]; nextCursor: string | null }> {
  const conditions = [eq(imageHostings.orgId, orgId), eq(imageHostings.status, 'active')]

  if (opts.pathPrefix) {
    conditions.push(like(imageHostings.path, `${opts.pathPrefix}%`))
  }

  if (opts.cursor) {
    // cursor is base64url-encoded ISO timestamp
    try {
      const ts = new Date(Buffer.from(opts.cursor, 'base64url').toString())
      if (!Number.isNaN(ts.getTime())) {
        conditions.push(gt(imageHostings.createdAt, ts))
      }
    } catch {
      // ignore invalid cursor
    }
  }

  const items = await db
    .select()
    .from(imageHostings)
    .where(and(...conditions))
    .orderBy(asc(imageHostings.createdAt))
    .limit(opts.limit + 1)

  const hasMore = items.length > opts.limit
  const page = hasMore ? items.slice(0, opts.limit) : items

  const nextCursor =
    hasMore && page.length > 0 ? Buffer.from(page[page.length - 1].createdAt.toISOString()).toString('base64url') : null

  return { items: page, nextCursor }
}

export async function confirmImageHosting(
  db: Database,
  id: string,
  orgId: string,
): Promise<{ row: ImageHostingRow | null; quotaExceeded?: boolean }> {
  const existing = await getImageHosting(db, id, orgId)
  if (!existing) return { row: null }
  if (existing.status !== 'draft') return { row: null }

  const bytes = existing.size
  if (bytes > 0) {
    const allowed = await incrementImageQuotaIfAllowed(db, orgId, existing.storageId, bytes)
    if (!allowed) return { row: null, quotaExceeded: true }
  }

  const updated = await db
    .update(imageHostings)
    .set({ status: 'active' })
    .where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId), eq(imageHostings.status, 'draft')))
    .returning({ id: imageHostings.id })

  if (updated.length === 0) {
    // Concurrent confirm — rollback quota
    if (bytes > 0) {
      await decrementImageQuota(db, orgId, existing.storageId, bytes)
    }
    return { row: null }
  }

  return { row: { ...existing, status: 'active' } }
}

export async function deleteImageHosting(db: Database, id: string, orgId: string): Promise<ImageHostingRow | null> {
  const existing = await getImageHosting(db, id, orgId)
  if (!existing) return null

  await db.delete(imageHostings).where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId)))

  if (existing.status === 'active' && existing.size > 0) {
    await decrementImageQuota(db, orgId, existing.storageId, existing.size)
  }

  return existing
}

export async function incrementImageQuotaIfAllowed(
  db: Database,
  orgId: string,
  storageId: string,
  bytes: number,
): Promise<boolean> {
  const rows = await db
    .select({ quota: orgQuotas.quota, used: orgQuotas.used })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))

  const [row] = rows
  if (row) {
    if (row.quota > 0 && row.used + bytes > row.quota) return false
    await db
      .update(orgQuotas)
      .set({ used: sql`${orgQuotas.used} + ${bytes}` })
      .where(eq(orgQuotas.orgId, orgId))
  }

  await db
    .update(storages)
    .set({ used: sql`${storages.used} + ${bytes}` })
    .where(eq(storages.id, storageId))

  return true
}

export async function decrementImageQuota(
  db: Database,
  orgId: string,
  storageId: string,
  bytes: number,
): Promise<void> {
  await db
    .update(storages)
    .set({ used: sql`MAX(0, ${storages.used} - ${bytes})` })
    .where(eq(storages.id, storageId))

  await db
    .update(orgQuotas)
    .set({ used: sql`MAX(0, ${orgQuotas.used} - ${bytes})` })
    .where(eq(orgQuotas.orgId, orgId))
}

export function buildImageUrl(config: ImageHostingConfigRow | null, path: string, tokenUrl: string): string {
  if (config?.customDomain && config.domainVerifiedAt) {
    return `https://${config.customDomain}/${path}`
  }
  return tokenUrl
}

export function deriveDefaultPath(filename: string, mime: string): string {
  const ext = mimeToExt(mime as AllowedImageMime)
  if (!filename || filename === 'blob') return `image-${nanoid(8)}.${ext}`
  // Strip path separators from the filename for safety
  const safe = filename.replace(/[/\\]/g, '_')
  return safe
}
