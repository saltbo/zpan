type AuditEventFact = {
  action: string
  userId?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
}

const BYTE_ACTIONS = new Set([
  'upload_confirm',
  'upload_failed',
  'share_download',
  'object_download',
  'image_hosting_download',
  'webdav_download',
  'download_failed',
  'save_from_share',
])

const UPLOAD_ACTIONS = new Set(['upload_confirm', 'upload_cancel', 'upload_failed'])
const DOWNLOAD_ACTIONS = new Set(['share_download', 'object_download', 'image_hosting_download', 'webdav_download'])
const SHARE_ACTIONS = new Set(['share_download', 'save_from_share'])
export function assertAuditEvent(event: AuditEventFact): void {
  const { action, metadata } = event
  if (BYTE_ACTIONS.has(action)) requireFiniteNonNegativeNumber(action, metadata, 'bytes')
  if (UPLOAD_ACTIONS.has(action)) requireNonEmptyString(action, metadata, 'source')
  if (DOWNLOAD_ACTIONS.has(action)) {
    requireNonEmptyString(action, metadata, 'source')
    requireNonEmptyString(action, metadata, 'trafficEventId')
  }
  if (SHARE_ACTIONS.has(action)) requireNonEmptyString(action, metadata, 'shareId')

  if (action === 'share_create') requireNonEmptyString(action, metadata, 'kind')
  if (action === 'user_register') requireNonEmptyString(action, metadata, 'provider')
}

function requireFiniteNonNegativeNumber(
  action: string,
  metadata: Record<string, unknown> | undefined,
  key: string,
): void {
  const value = metadata?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(action, key)
}

function requireNonEmptyString(action: string, metadata: Record<string, unknown> | undefined, key: string): void {
  const value = metadata?.[key]
  if (typeof value !== 'string' || value.length === 0) invalid(action, key)
}

function invalid(action: string, key: string): never {
  throw new Error(`invalid_audit_event:${action}:${key}`)
}
