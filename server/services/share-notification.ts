import { eq } from 'drizzle-orm'
import { user } from '../db/auth-schema'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'
import { sendEmail } from './email'
import { createNotification } from './notification'
import type { Share } from './share'

async function getUserEmail(db: Database, userId: string): Promise<string | null> {
  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  return rows[0]?.email ?? null
}

async function isEmailConfigured(db: Database): Promise<boolean> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'email_provider'))
    .limit(1)
  return Boolean(rows[0]?.value)
}

async function sendShareEmail(
  db: Database,
  opts: { to: string; creatorName: string; matterName: string; url: string; expiresAt: Date | null },
): Promise<void> {
  const expiryLine = opts.expiresAt ? `<p>This share expires on ${opts.expiresAt.toISOString().split('T')[0]}.</p>` : ''
  await sendEmail(db, {
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

export type RecipientInput = {
  recipientUserId?: string | null
  recipientEmail?: string | null
}

export async function dispatchShareCreated(
  db: Database,
  share: Share,
  recipients: RecipientInput[],
  creatorName: string,
  matterName: string,
): Promise<void> {
  const shareUrl = share.kind === 'landing' ? `/s/${share.token}` : `/r/${share.token}`
  const emailEnabled = await isEmailConfigured(db)

  for (const r of recipients) {
    if (r.recipientUserId) {
      await createNotification(db, {
        userId: r.recipientUserId,
        type: 'share_received',
        title: `${creatorName} shared "${matterName}" with you`,
        body: 'Click to open the share',
        refType: 'share',
        refId: share.id,
        metadata: JSON.stringify({ token: share.token, kind: share.kind }),
      })
    }

    const email = r.recipientEmail ?? (r.recipientUserId ? await getUserEmail(db, r.recipientUserId) : null)

    if (email && emailEnabled) {
      try {
        await sendShareEmail(db, { to: email, creatorName, matterName, url: shareUrl, expiresAt: share.expiresAt })
      } catch (err) {
        console.error(`[share-notification] email to ${email} failed:`, err)
      }
    }
  }
}
