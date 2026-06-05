import type { Downloader, DownloadTask } from '@shared/types'
import type { DownloaderRow, DownloadTaskRow } from './types'

export function toDownloader(row: DownloaderRow): Downloader {
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

export function toDownloadTask(row: DownloadTaskRow): DownloadTask {
  return {
    id: row.id,
    orgId: row.orgId,
    createdByUserId: row.createdByUserId,
    sourceType: row.sourceType as DownloadTask['sourceType'],
    sourceUri: row.sourceUri,
    name: row.name,
    targetFolder: row.targetFolder,
    category: row.category,
    tags: parseTaskTags(row.tags),
    assignedDownloaderId: row.assignedDownloaderId,
    status: row.status as DownloadTask['status'],
    downloadedBytes: row.downloadedBytes,
    storageUploadedBytes: row.uploadedBytes,
    totalBytes: row.totalBytes,
    authorizedBytes: row.authorizedBytes,
    billedBytes: row.billedBytes,
    billedCredits: row.billedCredits,
    billingStatus: row.billingStatus,
    downloadBps: row.downloadBps,
    storageUploadBps: row.uploadBps,
    errorMessage: row.errorMessage,
    resultObjectId: row.resultObjectId,
    detail: parseTaskDetail(row.detail),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

export function parseCapabilities(value: string): string[] {
  return parseStringArray(value)
}

function parseTaskDetail(value: string | null): DownloadTask['detail'] {
  if (!value) return null
  try {
    const detail = JSON.parse(value) as DownloadTask['detail'] & { uploadedBytes?: number }
    if (detail.peerUploadedBytes === undefined && detail.uploadedBytes !== undefined) {
      detail.peerUploadedBytes = detail.uploadedBytes
    }
    delete detail.uploadedBytes
    return detail
  } catch {
    return null
  }
}

function parseTaskTags(value: string): string[] {
  return parseStringArray(value)
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
