import { DirType } from '@shared/constants'
import type { Context } from 'hono'
import { recordAuditEffect } from '../lib/audit'
import type { AuditRepo, Matter, RecordAuditEventInput } from '../usecases/ports'
import { decodeChildRef } from '../usecases/share'
import { type AuditActor, auditActor } from './audit-actor'
import { type AuditRoute, type AuditRouteContext, auditRoute } from './audit-registry'
import type { AuthPrincipal, Env } from './platform'

export type TransferAuditTarget = {
  orgId: string
  targetType: 'file' | 'image' | 'share'
  targetId?: string
  targetName: string
  bytes: number
  source: string
  metadata?: Record<string, unknown>
}

type DownloadIssuedAction = 'share_download' | 'object_download' | 'image_hosting_download' | 'webdav_download'

const DOWNLOAD_FAILURE_STATUSES = new Set([402, 422, 500])
const UPLOAD_FAILURE_STATUSES = new Set([404, 409, 422, 500, 502])

export const TRANSFER_AUDIT_ROUTES: AuditRoute[] = [
  auditRoute(
    'POST',
    '/api/objects/:objectId/uploads/:sessionId/completions',
    uploadAction,
    {
      type: transferTargetType,
      id: async (context) => stringField(await context.response(), 'id') ?? transferTarget(context)?.targetId,
      name: async (context) => stringField(await context.response(), 'name') ?? transferTarget(context)?.targetName,
    },
    {
      statuses: (status) => status === 200 || UPLOAD_FAILURE_STATUSES.has(status),
      prepare: prepareObjectUpload,
      when: hasTransferTarget,
      orgId: ({ resource }) => transferTargetValue(resource)?.orgId,
      metadata: uploadMetadata,
    },
  ),
  auditRoute(
    'PUT',
    '/api/image-hosting/images/:imageId/status',
    uploadAction,
    {
      type: transferTargetType,
      id: async (context) => stringField(await context.response(), 'id') ?? transferTarget(context)?.targetId,
      name: async (context) => stringField(await context.response(), 'path') ?? transferTarget(context)?.targetName,
    },
    {
      statuses: (status) => status === 200 || UPLOAD_FAILURE_STATUSES.has(status),
      prepare: prepareImageUpload,
      when: hasTransferTarget,
      orgId: ({ resource }) => transferTargetValue(resource)?.orgId,
      metadata: uploadMetadata,
    },
  ),
  auditRoute(
    'POST',
    '/api/image-hosting/images',
    'upload_confirm',
    {
      type: transferTargetType,
      id: ({ resource }) => transferTargetValue(resource)?.targetId,
      name: transferTargetName,
    },
    {
      statuses: [201],
      resolve: resolveCreatedImageUpload,
      when: hasTransferTarget,
      orgId: ({ resource }) => transferTargetValue(resource)?.orgId,
      metadata: uploadMetadata,
    },
  ),
  auditRoute(
    'GET',
    '/api/objects/:objectId',
    'download_failed',
    {
      type: transferTargetType,
      id: ({ resource }) => transferTargetValue(resource)?.targetId,
      name: transferTargetName,
    },
    {
      statuses: isDownloadFailureStatus,
      prepare: prepareObjectDownload,
      when: hasTransferTarget,
      orgId: ({ resource }) => transferTargetValue(resource)?.orgId,
      metadata: downloadFailureMetadata,
    },
  ),
  auditRoute(
    'GET',
    '/api/shares/:token/objects/:childRef',
    'download_failed',
    {
      type: transferTargetType,
      id: ({ resource }) => transferTargetValue(resource)?.targetId,
      name: transferTargetName,
    },
    {
      statuses: isDownloadFailureStatus,
      prepare: prepareShareDownload,
      when: hasTransferTarget,
      orgId: ({ resource }) => transferTargetValue(resource)?.orgId,
      metadata: downloadFailureMetadata,
    },
  ),
]

export function isDownloadFailureStatus(status: number): boolean {
  return DOWNLOAD_FAILURE_STATUSES.has(status)
}

export function transferFailureReason(c: Context<Env>): string {
  const reason = c.get('errorLog')?.reason
  if (reason) return reason.toLowerCase()
  if (c.res.status === 402) return 'insufficient_credits'
  if (c.res.status === 404) return 'not_found'
  if (c.res.status === 409) return 'invalid_state'
  if (c.res.status === 422) return 'quota_exceeded'
  if (c.res.status === 502) return 'storage_failure'
  return 'internal'
}

export function recordUploadResult(
  audit: Pick<AuditRepo, 'record'>,
  actor: AuditActor,
  target: TransferAuditTarget,
  reason?: string,
): Promise<void> {
  const event = buildUploadResultEvent(actor, target, reason)
  return recordAuditEffect(event.action, () => audit.record(event))
}

export function recordDownloadFailure(
  audit: Pick<AuditRepo, 'record'>,
  actor: AuditActor,
  target: TransferAuditTarget,
  reason: string,
): Promise<void> {
  const event = buildDownloadFailureEvent(actor, target, reason)
  return recordAuditEffect(event.action, () => audit.record(event))
}

export function recordDownloadIssued(
  audit: Pick<AuditRepo, 'record'>,
  actor: AuditActor,
  action: DownloadIssuedAction,
  target: TransferAuditTarget,
  trafficEventId: string,
): Promise<void> {
  const event: RecordAuditEventInput = {
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
  }
  return recordAuditEffect(event.action, () => audit.record(event))
}

export function transferAuditActor(principal: AuthPrincipal | null): AuditActor {
  return auditActor(principal)
}

async function prepareObjectUpload({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const orgId = c.get('orgId')
  if (!orgId) return null
  const [matter, session] = await Promise.all([
    c.get('deps').matter.get(params.objectId, orgId),
    c.get('deps').objectUploadSessions.get(orgId, params.objectId, params.sessionId),
  ])
  if (!matter || !session || session.status !== 'active') return null
  return {
    orgId,
    targetType: 'file',
    targetId: matter.id,
    targetName: matter.name,
    bytes: matter.size ?? 0,
    source: 'upload',
    metadata: { matterId: matter.id, storageId: matter.storageId, sessionId: params.sessionId },
  } satisfies TransferAuditTarget
}

async function prepareImageUpload({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const orgId = c.get('orgId')
  if (!orgId) return null
  const image = await c.get('deps').imageHosting.get(params.imageId, orgId)
  return image?.status === 'draft' ? imageUploadTarget(image) : null
}

async function resolveCreatedImageUpload(context: AuditRouteContext): Promise<TransferAuditTarget | null> {
  const response = await context.response()
  const data = objectField(response, 'data')
  const token = data && tokenFromUrl(stringField(data, 'urlAlt'))
  if (!token) return null
  const resolved = await context.c.get('deps').imageHosting.resolveActiveByToken(token)
  return resolved ? imageUploadTarget(resolved.image) : null
}

async function prepareObjectDownload({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const orgId = c.get('orgId')
  if (!orgId) return null
  return matterDownloadTarget(await c.get('deps').matter.get(params.objectId, orgId))
}

async function prepareShareDownload({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const matterId = decodeChildRef(params.token, params.childRef)
  if (!matterId) return null
  const resolved = await c.get('deps').share.resolveByToken(params.token)
  if (resolved.status !== 'ok' || resolved.share.kind !== 'landing') return null
  const matter = await c.get('deps').matter.get(matterId, resolved.share.orgId)
  if (!matter || matter.trashedAt !== null || matter.dirtype !== DirType.FILE) return null
  return {
    orgId: resolved.share.orgId,
    targetType: 'share',
    targetId: resolved.share.id,
    targetName: matter.name,
    bytes: matter.size ?? 0,
    source: 'landing_share',
    metadata: { shareId: resolved.share.id, matterId: matter.id, storageId: matter.storageId },
  } satisfies TransferAuditTarget
}

function matterDownloadTarget(matter: Matter | null): TransferAuditTarget | null {
  if (!matter || matter.trashedAt !== null || matter.dirtype !== DirType.FILE || !matter.object) return null
  return {
    orgId: matter.orgId,
    targetType: 'file',
    targetId: matter.id,
    targetName: matter.name,
    bytes: matter.size ?? 0,
    source: 'object_download',
    metadata: { matterId: matter.id, storageId: matter.storageId },
  }
}

function imageUploadTarget(image: {
  id: string
  orgId: string
  path: string
  size: number
  storageId: string
}): TransferAuditTarget {
  return {
    orgId: image.orgId,
    targetType: 'image',
    targetId: image.id,
    targetName: image.path,
    bytes: image.size,
    source: 'image_hosting_upload',
    metadata: { imageId: image.id, storageId: image.storageId },
  }
}

function uploadAction({ c }: AuditRouteContext): string {
  return c.res.status >= 200 && c.res.status < 300 ? 'upload_confirm' : 'upload_failed'
}

function uploadMetadata(context: AuditRouteContext): Record<string, unknown> | undefined {
  const target = transferTarget(context)
  if (!target) return undefined
  const success = context.c.res.status >= 200 && context.c.res.status < 300
  return {
    ...target.metadata,
    bytes: target.bytes,
    source: target.source,
    status: success ? 'success' : 'failed',
    ...(success ? {} : { reason: transferFailureReason(context.c) }),
  }
}

function downloadFailureMetadata(context: AuditRouteContext): Record<string, unknown> | undefined {
  const target = transferTarget(context)
  if (!target) return undefined
  return {
    ...target.metadata,
    direction: 'download',
    status: 'failed',
    source: target.source,
    bytes: target.bytes,
    reason: transferFailureReason(context.c),
  }
}

function transferTarget(context: AuditRouteContext): TransferAuditTarget | null {
  return transferTargetValue(context.resource)
}

function transferTargetValue(value: unknown): TransferAuditTarget | null {
  return value && typeof value === 'object' ? (value as TransferAuditTarget) : null
}

function hasTransferTarget(context: AuditRouteContext): boolean {
  return transferTarget(context) !== null
}

function transferTargetType(context: AuditRouteContext): string {
  return transferTarget(context)?.targetType ?? 'file'
}

function transferTargetName(context: AuditRouteContext): string | undefined {
  return transferTarget(context)?.targetName
}

function buildUploadResultEvent(
  actor: AuditActor,
  target: TransferAuditTarget,
  reason?: string,
): RecordAuditEventInput {
  return {
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
}

function buildDownloadFailureEvent(
  actor: AuditActor,
  target: TransferAuditTarget,
  reason: string,
): RecordAuditEventInput {
  return {
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
  }
}

function stringField(value: Record<string, unknown>, field: string): string | undefined {
  return typeof value[field] === 'string' ? value[field] : undefined
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const nested = value[field]
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : undefined
}

function tokenFromUrl(value: string | undefined): string | null {
  if (!value) return null
  const pathname = new URL(value, 'https://zpan.invalid').pathname
  const match = pathname.match(/^\/r\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]).replace(/\.[^.]+$/, '') : null
}
