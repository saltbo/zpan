import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { organization } from '../../db/auth-schema'
import {
  auditEvents,
  backgroundJobs,
  downloadTasks,
  imageHostings,
  matters,
  orgQuotaEntitlements,
  orgQuotas,
  storageUsageBreakdowns,
  teamInviteLinks,
  webdavDeadProperties,
  webdavLocks,
} from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { DeletedOrganizationRepo } from '../../usecases/ports'

const ACTIVE_JOB_STATUSES = ['queued', 'running']

export function createDeletedOrganizationRepo(db: Database): DeletedOrganizationRepo {
  return {
    async listPendingPurge(limit) {
      // The org's quota row is removed last, so a space that still has one, or a
      // file not yet purged, was interrupted mid-purge or never reached.
      const rows = await db
        .selectDistinct({ orgId: auditEvents.targetId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, 'team_delete'),
            sql`${auditEvents.targetId} IS NOT NULL`,
            sql`NOT EXISTS (SELECT 1 FROM ${organization} WHERE ${organization.id} = ${auditEvents.targetId})`,
            sql`(
              EXISTS (SELECT 1 FROM ${orgQuotas} WHERE ${orgQuotas.orgId} = ${auditEvents.targetId})
              OR EXISTS (
                SELECT 1 FROM ${matters}
                WHERE ${matters.orgId} = ${auditEvents.targetId} AND ${matters.purgedAt} IS NULL
              )
            )`,
          ),
        )
        .limit(limit)
      return rows.flatMap((row) => (row.orgId ? [row.orgId] : []))
    },

    async listImageHostingObjects(orgId) {
      const rows = await db
        .select({ storageId: imageHostings.storageId, key: imageHostings.storageKey })
        .from(imageHostings)
        .where(and(eq(imageHostings.orgId, orgId), isNull(imageHostings.purgedAt)))
      return rows
    },

    listLiveDownloadTasks(orgId) {
      return db
        .select({ id: downloadTasks.id, status: downloadTasks.status })
        .from(downloadTasks)
        .where(and(eq(downloadTasks.orgId, orgId), isNull(downloadTasks.deletedAt)))
    },

    async listActiveBackgroundJobIds(orgId) {
      const rows = await db
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.orgId, orgId), inArray(backgroundJobs.status, ACTIVE_JOB_STATUSES)))
      return rows.map((row) => row.id)
    },

    async deleteSpaceRows(orgId) {
      await executeWriteTransaction(db, [
        db.delete(orgQuotaEntitlements).where(eq(orgQuotaEntitlements.orgId, orgId)),
        db.delete(storageUsageBreakdowns).where(eq(storageUsageBreakdowns.orgId, orgId)),
        db.delete(webdavLocks).where(eq(webdavLocks.orgId, orgId)),
        db.delete(webdavDeadProperties).where(eq(webdavDeadProperties.orgId, orgId)),
        db.delete(teamInviteLinks).where(eq(teamInviteLinks.organizationId, orgId)),
        db.delete(orgQuotas).where(eq(orgQuotas.orgId, orgId)),
      ])
    },
  }
}
