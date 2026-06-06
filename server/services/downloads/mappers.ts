import { downloadTaskRuntimeSchema } from '@shared/schemas'
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
  const runtime = parseTaskRuntime(row.runtime)
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdByUserId,
    spec: {
      source: {
        type: row.sourceType as DownloadTask['spec']['source']['type'],
        uri: row.sourceUri,
      },
      destination: {
        folder: row.targetFolder,
        name: row.displayName,
      },
      labels: {
        category: row.category,
        tags: parseTaskTags(row.tags),
      },
    },
    status: {
      state: row.status as DownloadTask['status']['state'],
      attempt: row.attempt,
      assignment: row.assignedDownloaderId
        ? { downloaderId: row.assignedDownloaderId, assignedAt: row.assignedAt?.toISOString() ?? null }
        : null,
      progress: runtime?.progress ?? emptyTaskProgress(),
      billing: {
        state: row.billingStatus as DownloadTask['status']['billing']['state'],
        authorizedBytes: row.billingAuthorizedBytes,
        chargedBytes: row.billingChargedBytes,
        chargedCredits: row.billingChargedCredits,
      },
      output: row.resultObjectId ? { objectId: row.resultObjectId } : null,
      runtime,
      error: row.errorMessage ? { code: row.errorCode, message: row.errorMessage } : null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
    createdAt: row.createdAt.toISOString(),
  }
}

export function parseCapabilities(value: string): string[] {
  return parseStringArray(value)
}

function parseTaskRuntime(value: string | null): DownloadTask['status']['runtime'] {
  if (!value) return null
  return downloadTaskRuntimeSchema.parse(JSON.parse(value))
}

function emptyTaskProgress(): DownloadTask['status']['progress'] {
  return {
    download: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
    upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
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
