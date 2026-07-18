import { describe, expect, it } from 'vitest'
import { assertAdminStatsEvent } from './admin-stats-events'

describe('admin stats event contract', () => {
  it('accepts complete transfer and sharing facts', () => {
    expect(() =>
      assertAdminStatsEvent('share_download', {
        bytes: 42,
        source: 'landing_share',
        trafficEventId: 'traffic-1',
        shareId: 'share-1',
      }),
    ).not.toThrow()
    expect(() => assertAdminStatsEvent('share_view', { shareId: 'share-1' })).not.toThrow()
  })

  it('rejects new stats facts with incomplete dimensions', () => {
    expect(() => assertAdminStatsEvent('upload_confirm', { source: 'upload' })).toThrow(
      'invalid_admin_stats_event:upload_confirm:bytes',
    )
    expect(() => assertAdminStatsEvent('object_download', { bytes: 42, source: 'object_download' })).toThrow(
      'invalid_admin_stats_event:object_download:trafficEventId',
    )
    expect(() => assertAdminStatsEvent('share_view', {})).toThrow('invalid_admin_stats_event:share_view:shareId')
  })

  it('does not constrain unrelated audit events', () => {
    expect(() => assertAdminStatsEvent('branding_update', undefined)).not.toThrow()
  })
})
