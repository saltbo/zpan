import type { Downloader } from '@shared/types'
import { and, asc, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm'
import { downloaders } from '../../db/schema'
import type { Database } from '../../platform/interface'
import {
  type CreateDownloaderRecordInput,
  DownloadError,
  type DownloaderHeartbeatFields,
  type DownloaderRecord,
  type DownloaderRepo,
  type UpdateDownloaderFields,
} from '../../usecases/ports'

type DownloaderRow = typeof downloaders.$inferSelect

function parseCapabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function toRecord(row: DownloaderRow): DownloaderRecord {
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.tokenHash,
    tokenJti: row.tokenJti,
    status: row.status,
    enabled: row.enabled,
    version: row.version,
    hostname: row.hostname,
    platform: row.platform,
    arch: row.arch,
    engine: row.engine,
    capabilities: parseCapabilities(row.capabilities),
    maxConcurrentTasks: row.maxConcurrentTasks,
    currentTasks: row.currentTasks,
    downloadBps: row.downloadBps,
    uploadBps: row.uploadBps,
    freeDiskBytes: row.freeDiskBytes,
    remoteDownloadCreditBillingEnabled: row.remoteDownloadCreditBillingEnabled,
    remoteDownloadCreditUnitBytes: row.remoteDownloadCreditUnitBytes,
    remoteDownloadCreditPerUnit: row.remoteDownloadCreditPerUnit,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDownloader(row: DownloaderRow): Downloader {
  return {
    id: row.id,
    name: row.name,
    status: row.enabled ? (row.status as Downloader['status']) : 'disabled',
    enabled: row.enabled,
    version: row.version,
    hostname: row.hostname,
    platform: row.platform,
    arch: row.arch,
    engine: row.engine as Downloader['engine'],
    capabilities: parseCapabilities(row.capabilities),
    maxConcurrentTasks: row.maxConcurrentTasks,
    currentTasks: row.currentTasks,
    downloadBps: row.downloadBps,
    uploadBps: row.uploadBps,
    freeDiskBytes: row.freeDiskBytes,
    remoteDownloadCreditBillingEnabled: row.remoteDownloadCreditBillingEnabled,
    remoteDownloadCreditUnitBytes: row.remoteDownloadCreditUnitBytes,
    remoteDownloadCreditPerUnit: row.remoteDownloadCreditPerUnit,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const DEFAULT_REMOTE_DOWNLOAD_CREDIT_PER_UNIT = 1

export function createDownloaderRepo(db: Database): DownloaderRepo {
  async function findRow(id: string): Promise<DownloaderRow | null> {
    const rows = await db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
    return rows[0] ?? null
  }

  return {
    async insert(input: CreateDownloaderRecordInput) {
      await db.insert(downloaders).values({
        id: input.id,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenJti: input.tokenJti,
        status: 'offline',
        enabled: true,
        version: input.version,
        hostname: input.hostname,
        platform: input.platform,
        arch: input.arch,
        engine: input.engine,
        capabilities: JSON.stringify(input.capabilities),
        maxConcurrentTasks: input.maxConcurrentTasks,
        currentTasks: input.currentTasks,
        downloadBps: input.downloadBps,
        uploadBps: input.uploadBps,
        freeDiskBytes: input.freeDiskBytes,
        remoteDownloadCreditBillingEnabled: false,
        remoteDownloadCreditUnitBytes: input.remoteDownloadCreditUnitBytes,
        remoteDownloadCreditPerUnit: DEFAULT_REMOTE_DOWNLOAD_CREDIT_PER_UNIT,
        lastHeartbeatAt: null,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
    },

    async list() {
      const rows = await db.select().from(downloaders).orderBy(desc(downloaders.createdAt))
      return rows.map(toDownloader)
    },

    async get(id) {
      const row = await findRow(id)
      if (!row) throw new DownloadError('not_found')
      return toDownloader(row)
    },

    async getRecord(id) {
      const row = await findRow(id)
      if (!row) throw new DownloadError('not_found')
      return toRecord(row)
    },

    async findRecord(id) {
      const row = await findRow(id)
      return row ? toRecord(row) : null
    },

    async update(id, fields: UpdateDownloaderFields, now) {
      await db
        .update(downloaders)
        .set({
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.enabled !== undefined
            ? { enabled: fields.enabled, status: fields.enabled ? 'offline' : 'disabled' }
            : {}),
          ...(fields.remoteDownloadCreditBillingEnabled !== undefined
            ? { remoteDownloadCreditBillingEnabled: fields.remoteDownloadCreditBillingEnabled }
            : {}),
          ...(fields.remoteDownloadCreditUnitBytes !== undefined
            ? { remoteDownloadCreditUnitBytes: fields.remoteDownloadCreditUnitBytes }
            : {}),
          ...(fields.remoteDownloadCreditPerUnit !== undefined
            ? { remoteDownloadCreditPerUnit: fields.remoteDownloadCreditPerUnit }
            : {}),
          updatedAt: now,
        })
        .where(eq(downloaders.id, id))
    },

    async recordHeartbeat(id, fields: DownloaderHeartbeatFields, online, now) {
      await db
        .update(downloaders)
        .set({
          status: online ? 'online' : 'disabled',
          version: fields.version,
          hostname: fields.hostname,
          platform: fields.platform,
          arch: fields.arch,
          engine: fields.engine,
          capabilities: JSON.stringify(fields.capabilities),
          maxConcurrentTasks: fields.maxConcurrentTasks,
          currentTasks: fields.currentTasks,
          downloadBps: fields.downloadBps,
          uploadBps: fields.uploadBps,
          freeDiskBytes: fields.freeDiskBytes,
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(downloaders.id, id))
    },

    async delete(id) {
      await db.delete(downloaders).where(eq(downloaders.id, id))
    },

    async listAssignmentCandidates(leaseCutoff) {
      const rows = await db
        .select()
        .from(downloaders)
        .where(
          and(
            eq(downloaders.enabled, true),
            eq(downloaders.status, 'online'),
            gte(downloaders.lastHeartbeatAt, leaseCutoff),
            gt(downloaders.maxConcurrentTasks, downloaders.currentTasks),
          ),
        )
        .orderBy(asc(downloaders.currentTasks), asc(downloaders.downloadBps))
      return rows.map(toRecord)
    },

    async listStaleIds(leaseCutoff) {
      const rows = await db
        .select({ id: downloaders.id })
        .from(downloaders)
        .where(
          and(
            eq(downloaders.enabled, true),
            eq(downloaders.status, 'online'),
            lt(downloaders.lastHeartbeatAt, leaseCutoff),
          ),
        )
      return rows.map((row) => row.id)
    },

    async listUnreachableIds(leaseCutoff) {
      // No status filter: a downloader already flipped to 'offline' by an earlier
      // sweep can still hold canceling/pausing tasks that need settling.
      const rows = await db
        .select({ id: downloaders.id })
        .from(downloaders)
        .where(lt(downloaders.lastHeartbeatAt, leaseCutoff))
      return rows.map((row) => row.id)
    },

    async markStaleOffline(ids, now) {
      if (ids.length === 0) return
      await db
        .update(downloaders)
        .set({ status: 'offline', currentTasks: 0, downloadBps: 0, uploadBps: 0, updatedAt: now })
        .where(inArray(downloaders.id, ids))
    },
  }
}
