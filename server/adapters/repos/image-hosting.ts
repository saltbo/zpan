import { and, asc, eq, gt, isNotNull, like, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { imageHostingConfigs, imageHostings } from '../../db/schema'
import { mimeToExt } from '../../lib/mime-utils'
import type { Database } from '../../platform/interface'
import type {
  CreateImageHostingInput,
  ImageHostingRecord,
  ImageHostingRepo,
  ImageResolution,
} from '../../usecases/ports'

type ImageHostingRow = typeof imageHostings.$inferSelect

const MAX_COLLISION_RETRIES = 5

function toRecord(row: ImageHostingRow): ImageHostingRecord {
  return row as unknown as ImageHostingRecord
}

function parseRefererAllowlist(value: string | null): string[] {
  return value ? (JSON.parse(value) as string[]) : []
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

export function createImageHostingRepo(db: Database): ImageHostingRepo {
  async function resolveUniquePath(orgId: string, requestedPath: string): Promise<string> {
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

  return {
    async resolveActiveByToken(token): Promise<ImageResolution | null> {
      const rows = await db.select().from(imageHostings).where(eq(imageHostings.token, token)).limit(1)
      const row = rows[0]
      if (!row || row.status !== 'active') return null

      const configRows = await db
        .select()
        .from(imageHostingConfigs)
        .where(eq(imageHostingConfigs.orgId, row.orgId))
        .limit(1)

      return {
        image: toRecord(row),
        refererAllowlist: parseRefererAllowlist(configRows[0]?.refererAllowlist ?? null),
      }
    },

    async resolveCustomDomain(host) {
      const rows = await db
        .select({ orgId: imageHostingConfigs.orgId })
        .from(imageHostingConfigs)
        .where(and(eq(imageHostingConfigs.customDomain, host), isNotNull(imageHostingConfigs.domainVerifiedAt)))
        .limit(1)
      return rows[0]?.orgId ?? null
    },

    async resolveActiveByOrgPath(orgId, path): Promise<ImageResolution | null> {
      const rows = await db
        .select()
        .from(imageHostings)
        .where(and(eq(imageHostings.orgId, orgId), eq(imageHostings.path, path), eq(imageHostings.status, 'active')))
        .limit(1)
      if (!rows[0]) return null

      const configRows = await db
        .select()
        .from(imageHostingConfigs)
        .where(eq(imageHostingConfigs.orgId, orgId))
        .limit(1)
      if (configRows.length === 0) return null

      return {
        image: toRecord(rows[0]),
        refererAllowlist: parseRefererAllowlist(configRows[0].refererAllowlist),
      }
    },

    async incrementAccessCount(id) {
      await db.run(
        sql`UPDATE image_hostings SET access_count = access_count + 1, last_accessed_at = ${Date.now()} WHERE id = ${id}`,
      )
    },

    async create(input: CreateImageHostingInput) {
      const id = nanoid(12)
      const token = `ih_${nanoid(10)}`
      const ext = mimeToExt(input.mime)
      const storageKey = `ih/${input.orgId}/${id}.${ext}`
      const now = new Date()

      const resolvedPath = await resolveUniquePath(input.orgId, input.path)

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
      return toRecord(row)
    },

    async get(id, orgId) {
      const rows = await db
        .select()
        .from(imageHostings)
        .where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId)))
      return rows[0] ? toRecord(rows[0]) : null
    },

    async list(orgId, opts) {
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
        hasMore && page.length > 0
          ? Buffer.from(page[page.length - 1].createdAt.toISOString()).toString('base64url')
          : null

      return { items: page.map(toRecord), nextCursor }
    },

    async setActive(id, orgId) {
      const updated = await db
        .update(imageHostings)
        .set({ status: 'active' })
        .where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId), eq(imageHostings.status, 'draft')))
        .returning({ id: imageHostings.id })
      return updated.length > 0
    },

    async delete(id, orgId) {
      await db.delete(imageHostings).where(and(eq(imageHostings.id, id), eq(imageHostings.orgId, orgId)))
    },
  }
}
