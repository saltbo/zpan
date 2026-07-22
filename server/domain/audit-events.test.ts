import { describe, expect, it } from 'vitest'
import { assertAuditEvent } from './audit-events'

function event(action: string, metadata?: Record<string, unknown>) {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    action,
    targetType: 'file',
    targetId: 'target-1',
    targetName: 'target',
    metadata,
  }
}

describe('audit event contract', () => {
  it('accepts complete transfer and sharing events', () => {
    expect(() =>
      assertAuditEvent(
        event('share_download', {
          bytes: 42,
          source: 'landing_share',
          trafficEventId: 'traffic-1',
          shareId: 'share-1',
        }),
      ),
    ).not.toThrow()
    expect(() =>
      assertAuditEvent(event('download_failed', { bytes: 42, source: 'object_download', reason: 'quota_exceeded' })),
    ).not.toThrow()
  })

  it('rejects incomplete statistical events', () => {
    expect(() => assertAuditEvent(event('upload_confirm', { source: 'upload' }))).toThrow(
      'invalid_audit_event:upload_confirm:bytes',
    )
    expect(() => assertAuditEvent(event('object_download', { bytes: 42, source: 'object_download' }))).toThrow(
      'invalid_audit_event:object_download:trafficEventId',
    )
    expect(() => assertAuditEvent(event('user_register'))).toThrow('invalid_audit_event:user_register:provider')
  })

  it('accepts a registration event with its authentication provider', () => {
    expect(() => assertAuditEvent(event('user_register', { provider: 'credential' }))).not.toThrow()
  })

  it('does not constrain unrelated audit events', () => {
    expect(() => assertAuditEvent(event('branding_update'))).not.toThrow()
  })
})
