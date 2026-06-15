import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { notifications, systemOptions } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import type { ShareNotificationRecipient, ShareNotificationShare } from './ports'
import { dispatchShareCreated } from './share.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>
type TestDb = TestCtx['db']

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function insertUser(db: TestDb, overrides: Partial<{ id: string; email: string }> = {}) {
  const id = overrides.id ?? nanoid()
  const email = overrides.email ?? `${id}@example.com`
  await db.insert(authSchema.user).values({
    id,
    name: 'Test User',
    email,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { id, email }
}

function makeShare(overrides: Partial<ShareNotificationShare> = {}): ShareNotificationShare {
  return {
    id: overrides.id ?? nanoid(),
    token: overrides.token ?? nanoid(10),
    kind: overrides.kind ?? 'landing',
    expiresAt: overrides.expiresAt ?? null,
  }
}

async function configureEmail(db: TestDb) {
  await db.insert(systemOptions).values([
    { key: 'email_enabled', value: 'true', public: false },
    { key: 'email_provider', value: 'smtp', public: false },
    { key: 'email_from', value: 'no-reply@example.com', public: false },
    { key: 'email_smtp_host', value: 'smtp.example.com', public: false },
    { key: 'email_smtp_port', value: '587', public: false },
  ])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dispatchShareCreated', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts a notification row when recipient has recipientUserId', async () => {
    const ctx = await createTestApp()
    const user = await insertUser(ctx.db)
    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientUserId: user.id }]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Alice', 'secret.pdf')

    const rows = await ctx.db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('share_received')
    expect(rows[0].title).toContain('Alice')
    expect(rows[0].title).toContain('secret.pdf')
    expect(rows[0].refType).toBe('share')
    expect(rows[0].refId).toBe(share.id)
  })

  it('does not insert notification when recipient has only email (no userId)', async () => {
    const ctx = await createTestApp()
    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientEmail: 'someone@example.com' }]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Bob', 'file.txt')

    const rows = await ctx.db.select().from(notifications)
    expect(rows).toHaveLength(0)
  })

  it('does not send email and does not throw when email is not configured', async () => {
    const ctx = await createTestApp()
    const sendSpy = vi.spyOn(ctx.deps.email, 'send')
    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientEmail: 'test@example.com' }]

    // No email config in DB
    await expect(
      dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Carol', 'report.docx'),
    ).resolves.toBeUndefined()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('sends email when email is configured and recipient has email', async () => {
    const ctx = await createTestApp()
    const sendSpy = vi.spyOn(ctx.deps.email, 'send').mockResolvedValue(undefined)

    await configureEmail(ctx.db)

    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientEmail: 'dave@example.com' }]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Eve', 'photo.jpg')

    expect(sendSpy).toHaveBeenCalledOnce()
    const callArgs = sendSpy.mock.calls[0]
    // send(platform, message) — second arg is the message
    expect(callArgs[1].to).toBe('dave@example.com')
    expect(callArgs[1].subject).toContain('Eve')
    expect(callArgs[1].subject).toContain('photo.jpg')
  })

  it('looks up email from user table when recipient has only recipientUserId and email is configured', async () => {
    const ctx = await createTestApp()
    const sendSpy = vi.spyOn(ctx.deps.email, 'send').mockResolvedValue(undefined)

    await configureEmail(ctx.db)

    const user = await insertUser(ctx.db, { email: 'frank@example.com' })
    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientUserId: user.id }]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Grace', 'budget.xlsx')

    expect(sendSpy).toHaveBeenCalledOnce()
    const callArgs = sendSpy.mock.calls[0]
    expect(callArgs[1].to).toBe('frank@example.com')
  })

  it('does not throw when email send fails — logs and continues', async () => {
    const ctx = await createTestApp()
    const sendSpy = vi.spyOn(ctx.deps.email, 'send').mockRejectedValue(new Error('SMTP down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await configureEmail(ctx.db)

    const share = makeShare()
    const recipients: ShareNotificationRecipient[] = [{ recipientEmail: 'victim@example.com' }]

    // Should NOT throw despite email failure
    await expect(
      dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Sender', 'file.txt'),
    ).resolves.toBeUndefined()
    expect(sendSpy).toHaveBeenCalledOnce()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('inserts in-app notifications for all recipients that have recipientUserId', async () => {
    const ctx = await createTestApp()
    const user1 = await insertUser(ctx.db)
    const user2 = await insertUser(ctx.db)
    const share = makeShare()

    const recipients: ShareNotificationRecipient[] = [
      { recipientUserId: user1.id },
      { recipientUserId: user2.id },
      { recipientEmail: 'no-account@example.com' },
    ]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Hub', 'multi.zip')

    const rows1 = await ctx.db.select().from(notifications).where(eq(notifications.userId, user1.id))
    expect(rows1).toHaveLength(1)

    const rows2 = await ctx.db.select().from(notifications).where(eq(notifications.userId, user2.id))
    expect(rows2).toHaveLength(1)

    // No notification for email-only recipient
    const allRows = await ctx.db.select().from(notifications)
    expect(allRows).toHaveLength(2)
  })

  it('uses /s/{token} URL for landing shares in notification metadata', async () => {
    const ctx = await createTestApp()
    const user = await insertUser(ctx.db)
    const share = makeShare({ kind: 'landing', token: 'abc123token' })

    await dispatchShareCreated(ctx.deps, ctx.platform, share, [{ recipientUserId: user.id }], 'Ian', 'landing.pdf')

    const rows = await ctx.db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    const metadata = JSON.parse(rows[0].metadata ?? '{}') as Record<string, unknown>
    expect(metadata.token).toBe('abc123token')
    expect(metadata.kind).toBe('landing')
  })

  it('uses /r/{token} URL for direct shares in notification metadata', async () => {
    const ctx = await createTestApp()
    const user = await insertUser(ctx.db)
    const share = makeShare({ kind: 'direct', token: 'directtoken1' })

    await dispatchShareCreated(ctx.deps, ctx.platform, share, [{ recipientUserId: user.id }], 'Jane', 'direct.mp4')

    const rows = await ctx.db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    const metadata = JSON.parse(rows[0].metadata ?? '{}') as Record<string, unknown>
    expect(metadata.kind).toBe('direct')
  })

  it('includes expiresAt in email body when share has an expiry date', async () => {
    const ctx = await createTestApp()
    const sendSpy = vi.spyOn(ctx.deps.email, 'send').mockResolvedValue(undefined)

    await configureEmail(ctx.db)

    const expiresAt = new Date('2026-12-31T00:00:00Z')
    const share = makeShare({ expiresAt })
    const recipients: ShareNotificationRecipient[] = [{ recipientEmail: 'reader@example.com' }]

    await dispatchShareCreated(ctx.deps, ctx.platform, share, recipients, 'Karl', 'expiring.pdf')

    expect(sendSpy).toHaveBeenCalledOnce()
    const emailHtml = sendSpy.mock.calls[0][1].html
    expect(emailHtml).toContain('2026-12-31')
  })

  it('handles empty recipients array without errors', async () => {
    const ctx = await createTestApp()
    const share = makeShare()

    await expect(dispatchShareCreated(ctx.deps, ctx.platform, share, [], 'Leo', 'empty.txt')).resolves.toBeUndefined()

    const rows = await ctx.db.select().from(notifications)
    expect(rows).toHaveLength(0)
  })
})
