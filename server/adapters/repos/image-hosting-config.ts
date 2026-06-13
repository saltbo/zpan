import { eq } from 'drizzle-orm'
import { imageHostingConfigs } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { ImageHostingConfigRecord, ImageHostingConfigRepo } from '../../usecases/ports'

export function createImageHostingConfigRepo(db: Database): ImageHostingConfigRepo {
  return {
    async getByOrg(orgId) {
      const rows = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)
      return (rows[0] as ImageHostingConfigRecord | undefined) ?? null
    },

    async create(input) {
      const now = new Date()
      await db.insert(imageHostingConfigs).values({
        orgId: input.orgId,
        customDomain: input.customDomain,
        cfHostnameId: input.cfHostnameId,
        domainVerifiedAt: null,
        refererAllowlist: input.refererAllowlist,
        createdAt: now,
        updatedAt: now,
      })
    },

    async update(orgId, set) {
      await db
        .update(imageHostingConfigs)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(imageHostingConfigs.orgId, orgId))
    },

    async delete(orgId) {
      await db.delete(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId))
    },
  }
}
