import type { Platform } from '../platform/interface'
import type {
  EmailGateway,
  NotificationRepo,
  ShareNotificationRecipient,
  ShareNotificationRepo,
  ShareNotificationShare,
} from './ports'

export type ShareNotificationDeps = {
  notifications: NotificationRepo
  email: EmailGateway
  shareNotifications: ShareNotificationRepo
}

async function sendShareEmail(
  deps: ShareNotificationDeps,
  platform: Platform,
  opts: { to: string; creatorName: string; matterName: string; url: string; expiresAt: Date | null },
): Promise<void> {
  const expiryLine = opts.expiresAt ? `<p>This share expires on ${opts.expiresAt.toISOString().split('T')[0]}.</p>` : ''
  await deps.email.send(platform, {
    to: opts.to,
    subject: `${opts.creatorName} shared "${opts.matterName}" with you`,
    html: `
      <h2>${opts.creatorName} shared a file with you</h2>
      <p><strong>${opts.matterName}</strong> is now available.</p>
      ${expiryLine}
      <p><a href="${opts.url}">Open share</a></p>
    `,
  })
}

export async function dispatchShareCreated(
  deps: ShareNotificationDeps,
  platform: Platform,
  share: ShareNotificationShare,
  recipients: ShareNotificationRecipient[],
  creatorName: string,
  matterName: string,
): Promise<void> {
  const shareUrl = share.kind === 'landing' ? `/s/${share.token}` : `/r/${share.token}`
  const emailEnabled = await deps.email.isConfigured(platform)

  for (const r of recipients) {
    if (r.recipientUserId) {
      await deps.notifications.create({
        userId: r.recipientUserId,
        type: 'share_received',
        title: `${creatorName} shared "${matterName}" with you`,
        body: 'Click to open the share',
        refType: 'share',
        refId: share.id,
        metadata: JSON.stringify({ token: share.token, kind: share.kind, creatorName, matterName }),
      })
    }

    const email =
      r.recipientEmail ?? (r.recipientUserId ? await deps.shareNotifications.getUserEmail(r.recipientUserId) : null)

    if (email && emailEnabled) {
      try {
        await sendShareEmail(deps, platform, {
          to: email,
          creatorName,
          matterName,
          url: shareUrl,
          expiresAt: share.expiresAt,
        })
      } catch (err) {
        console.error(`[share-notification] email to ${email} failed:`, err)
      }
    }
  }
}
