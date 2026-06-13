import type { Notification } from '@shared/types'
import type { TFunction } from 'i18next'

function parseMeta(notification: Notification): Record<string, unknown> {
  if (!notification.metadata) return {}
  try {
    return JSON.parse(notification.metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

function archiveAction(meta: Record<string, unknown>, t: TFunction): string {
  return t(meta.jobType === 'archive_extract' ? 'notification.action.extraction' : 'notification.action.compression')
}

/**
 * Localizes a notification for display. Server-stored title/body are English
 * fallbacks; when the type and metadata are known we render from i18n instead,
 * so notifications respect the user's language. Unknown types fall back to the
 * stored strings (keeps older notifications working).
 */
export function notificationContent(notification: Notification, t: TFunction): { title: string; body: string } {
  const meta = parseMeta(notification)
  switch (notification.type) {
    case 'share_received':
      if (typeof meta.creatorName === 'string' && typeof meta.matterName === 'string') {
        return {
          title: t('notification.shareReceived.title', { creatorName: meta.creatorName, matterName: meta.matterName }),
          body: t('notification.shareReceived.body'),
        }
      }
      break
    case 'archive_job_completed':
      return {
        title: t('notification.archiveCompleted', { action: archiveAction(meta, t) }),
        body: t('notification.archiveCompletedBody'),
      }
    case 'archive_job_failed':
      return {
        title: t('notification.archiveFailed', { action: archiveAction(meta, t) }),
        body: notification.body || t('notification.archiveFailedBody'),
      }
    case 'team_join':
      if (typeof meta.teamName === 'string') {
        return {
          title: t('notification.teamJoin.title', { teamName: meta.teamName }),
          body: t('notification.teamJoin.body'),
        }
      }
      break
  }
  return { title: notification.title, body: notification.body }
}
