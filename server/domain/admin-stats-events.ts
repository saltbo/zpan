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
const DOWNLOAD_ACTIONS = new Set([
  'share_download',
  'object_download',
  'image_hosting_download',
  'webdav_download',
  'download_failed',
])
const SHARE_ACTIONS = new Set(['share_view', 'share_download', 'save_from_share', 'share_password_passed'])

export function assertAdminStatsEvent(action: string, metadata: Record<string, unknown> | undefined): void {
  if (!BYTE_ACTIONS.has(action) && !UPLOAD_ACTIONS.has(action) && !SHARE_ACTIONS.has(action)) return

  if (BYTE_ACTIONS.has(action)) requireFiniteNonNegativeNumber(action, metadata, 'bytes')
  if (UPLOAD_ACTIONS.has(action)) requireNonEmptyString(action, metadata, 'source')
  if (DOWNLOAD_ACTIONS.has(action)) {
    requireNonEmptyString(action, metadata, 'source')
    requireNonEmptyString(action, metadata, 'trafficEventId')
  }
  if (SHARE_ACTIONS.has(action)) requireNonEmptyString(action, metadata, 'shareId')
}

function requireFiniteNonNegativeNumber(
  action: string,
  metadata: Record<string, unknown> | undefined,
  key: string,
): void {
  const value = metadata?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid_admin_stats_event:${action}:${key}`)
  }
}

function requireNonEmptyString(action: string, metadata: Record<string, unknown> | undefined, key: string): void {
  const value = metadata?.[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid_admin_stats_event:${action}:${key}`)
}
