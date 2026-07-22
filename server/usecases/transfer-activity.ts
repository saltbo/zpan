import { recordAuditEffect } from '../lib/audit'
import type { Deps } from './deps'
import type { RecordAuditEventInput } from './ports'

export type TransferAuditTarget = {
  orgId: string
  targetType: 'file' | 'image' | 'share'
  targetId?: string
  targetName: string
  bytes: number
  source: string
  metadata?: Record<string, unknown>
}

type TransferAuditActor = Pick<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef'>
type DownloadIssuedAction = 'share_download' | 'object_download' | 'image_hosting_download' | 'webdav_download'

export function createTrafficEventId(): string {
  return `traffic_${crypto.randomUUID()}`
}

export function recordAuditEvent(deps: Pick<Deps, 'audit'>, event: RecordAuditEventInput): Promise<void> {
  return recordAuditEffect(event.action, () => deps.audit.record(event))
}

export function recordAuditEventOnce(
  deps: Pick<Deps, 'audit'>,
  event: RecordAuditEventInput,
  idempotencyKey: string,
  occurredAt: Date,
): Promise<void> {
  return recordAuditEffect(event.action, () => deps.audit.recordOnce(event, idempotencyKey, occurredAt))
}

export function recordUploadResult(
  deps: Pick<Deps, 'audit'>,
  actor: TransferAuditActor,
  target: TransferAuditTarget,
  reason?: string,
): Promise<void> {
  const event: RecordAuditEventInput = {
    ...actor,
    orgId: target.orgId,
    action: reason ? 'upload_failed' : 'upload_confirm',
    targetType: target.targetType,
    targetId: target.targetId,
    targetName: target.targetName,
    metadata: {
      ...target.metadata,
      bytes: target.bytes,
      source: target.source,
      status: reason ? 'failed' : 'success',
      ...(reason ? { reason } : {}),
    },
  }
  return recordAuditEvent(deps, event)
}

export function recordDownloadFailure(
  deps: Pick<Deps, 'audit'>,
  actor: TransferAuditActor,
  target: TransferAuditTarget,
  reason: string,
): Promise<void> {
  return recordAuditEvent(deps, {
    ...actor,
    orgId: target.orgId,
    action: 'download_failed',
    targetType: target.targetType,
    targetId: target.targetId,
    targetName: target.targetName,
    metadata: {
      ...target.metadata,
      direction: 'download',
      status: 'failed',
      source: target.source,
      bytes: target.bytes,
      reason,
    },
  })
}

export function recordDownloadIssued(
  deps: Pick<Deps, 'audit'>,
  actor: TransferAuditActor,
  action: DownloadIssuedAction,
  target: TransferAuditTarget,
  trafficEventId: string,
): Promise<void> {
  return recordAuditEvent(deps, {
    ...actor,
    orgId: target.orgId,
    action,
    targetType: target.targetType,
    targetId: target.targetId,
    targetName: target.targetName,
    metadata: {
      ...target.metadata,
      direction: 'download',
      status: 'issued',
      source: target.source,
      bytes: target.bytes,
      trafficEventId,
    },
  })
}
