import { eq, isNotNull } from 'drizzle-orm'
import { imageHostingConfigs } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { ImageHostingConfigRecord, ImageHostingConfigRepo } from '../../usecases/ports'

export function createImageHostingConfigRepo(db: Database): ImageHostingConfigRepo {
  return {
    async getByOrg(orgId) {
      const rows = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)
      return (rows[0] as ImageHostingConfigRecord | undefined) ?? null
    },

    async getByDomain(domain) {
      const rows = await db
        .select()
        .from(imageHostingConfigs)
        .where(eq(imageHostingConfigs.customDomain, domain))
        .limit(1)
      return (rows[0] as ImageHostingConfigRecord | undefined) ?? null
    },

    async listWithDomains() {
      const rows = await db.select().from(imageHostingConfigs).where(isNotNull(imageHostingConfigs.customDomain))
      return rows as ImageHostingConfigRecord[]
    },

    async create(input) {
      const now = new Date()
      await db.insert(imageHostingConfigs).values({
        orgId: input.orgId,
        customDomain: input.customDomain,
        domainProvider: input.domainProvider,
        providerHostnameId: input.providerHostnameId,
        domainStatus: input.domainStatus,
        domainError: input.domainError,
        verificationToken: input.verificationToken,
        domainLastCheckedAt: null,
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

    async markAllDomainsPending(provider, preserveExternalIds) {
      await db
        .update(imageHostingConfigs)
        .set({
          domainProvider: provider,
          ...(preserveExternalIds ? {} : { providerHostnameId: null }),
          domainStatus: 'pending_dns',
          domainError: null,
          domainVerifiedAt: null,
          domainLastCheckedAt: null,
          updatedAt: new Date(),
        })
        .where(isNotNull(imageHostingConfigs.customDomain))
    },

    async delete(orgId) {
      await db.delete(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId))
    },
  }
}
