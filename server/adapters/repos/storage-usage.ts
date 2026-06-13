import { DirType } from '@shared/constants'
import { eq, sql } from 'drizzle-orm'
import { imageHostings, matters, orgQuotas, storages } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { StorageUsageRepo } from '../../usecases/ports'

export function createStorageUsageRepo(db: Database): StorageUsageRepo {
  return {
    async rollbackReservations(reservations) {
      const bytesByStorage = new Map<string, number>()
      const bytesByOrg = new Map<string, number>()

      for (const reservation of reservations) {
        if (!reservation || reservation.bytes <= 0) continue
        bytesByStorage.set(reservation.storageId, (bytesByStorage.get(reservation.storageId) ?? 0) + reservation.bytes)
        bytesByOrg.set(reservation.orgId, (bytesByOrg.get(reservation.orgId) ?? 0) + reservation.bytes)
      }

      for (const [storageId, bytes] of bytesByStorage) {
        await db
          .update(storages)
          .set({ used: sql`MAX(0, ${storages.used} - ${bytes})` })
          .where(eq(storages.id, storageId))
      }

      for (const [orgId, bytes] of bytesByOrg) {
        await db
          .update(orgQuotas)
          .set({ used: sql`MAX(0, ${orgQuotas.used} - ${bytes})` })
          .where(eq(orgQuotas.orgId, orgId))
      }
    },

    async reconcile(orgId, storageIds = []) {
      await db
        .update(orgQuotas)
        .set({
          used: sql`COALESCE((
            SELECT SUM(${matters.size})
            FROM ${matters}
            WHERE ${matters.orgId} = ${orgId}
              AND ${matters.dirtype} = ${DirType.FILE}
              AND ${matters.status} IN ('active', 'trashed')
          ), 0) + COALESCE((
            SELECT SUM(${imageHostings.size})
            FROM ${imageHostings}
            WHERE ${imageHostings.orgId} = ${orgId}
              AND ${imageHostings.status} = 'active'
          ), 0)`,
        })
        .where(eq(orgQuotas.orgId, orgId))

      for (const storageId of new Set(storageIds)) {
        await db
          .update(storages)
          .set({
            used: sql`COALESCE((
              SELECT SUM(${matters.size})
              FROM ${matters}
              WHERE ${matters.storageId} = ${storageId}
                AND ${matters.dirtype} = ${DirType.FILE}
                AND ${matters.status} IN ('active', 'trashed')
            ), 0) + COALESCE((
              SELECT SUM(${imageHostings.size})
              FROM ${imageHostings}
              WHERE ${imageHostings.storageId} = ${storageId}
                AND ${imageHostings.status} = 'active'
            ), 0)`,
          })
          .where(eq(storages.id, storageId))
      }
    },
  }
}
