import { eq, sql } from 'drizzle-orm'
import type { ImageHosting } from '../../shared/types'
import { imageHostingConfigs, imageHostings } from '../db/schema'
import type { Database } from '../platform/interface'

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

export async function incrementAccessCount(db: Database, id: string): Promise<void> {
  await db.run(
    sql`UPDATE image_hostings SET access_count = access_count + 1, last_accessed_at = ${Date.now()} WHERE id = ${id}`,
  )
}
