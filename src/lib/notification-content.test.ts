import type { Notification } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { notificationContent } from './notification-content'

// Minimal i18n stub: echoes the key with interpolated params so assertions can
// verify which key + params were chosen without depending on locale text.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key) as never

function notif(overrides: Partial<Notification>): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'share_received',
    title: 'STORED TITLE',
    body: 'STORED BODY',
    refType: null,
    refId: null,
    metadata: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('notificationContent', () => {
  it('localizes share_received from metadata', () => {
    const result = notificationContent(
      notif({ type: 'share_received', metadata: JSON.stringify({ creatorName: 'Ada', matterName: 'plan.pdf' }) }),
      t,
    )
    expect(result.title).toBe('notification.shareReceived.title:{"creatorName":"Ada","matterName":"plan.pdf"}')
    expect(result.body).toBe('notification.shareReceived.body')
  })

  it('localizes archive completed/failed with the right action', () => {
    const completed = notificationContent(
      notif({ type: 'archive_job_completed', metadata: JSON.stringify({ jobType: 'archive_extract' }) }),
      t,
    )
    expect(completed.title).toBe('notification.archiveCompleted:{"action":"notification.action.extraction"}')

    const failed = notificationContent(
      notif({
        type: 'archive_job_failed',
        body: 'disk full',
        metadata: JSON.stringify({ jobType: 'archive_compress' }),
      }),
      t,
    )
    expect(failed.title).toBe('notification.archiveFailed:{"action":"notification.action.compression"}')
    // Failed body keeps the stored error message when present.
    expect(failed.body).toBe('disk full')
  })

  it('localizes team_join from metadata', () => {
    const result = notificationContent(notif({ type: 'team_join', metadata: JSON.stringify({ teamName: 'Acme' }) }), t)
    expect(result.title).toBe('notification.teamJoin.title:{"teamName":"Acme"}')
  })

  it('falls back to stored title/body when metadata is missing', () => {
    const result = notificationContent(notif({ type: 'share_received', metadata: null }), t)
    expect(result).toEqual({ title: 'STORED TITLE', body: 'STORED BODY' })
  })

  it('falls back to stored strings on malformed metadata', () => {
    const result = notificationContent(notif({ type: 'team_join', metadata: '{not json' }), t)
    expect(result).toEqual({ title: 'STORED TITLE', body: 'STORED BODY' })
  })
})
