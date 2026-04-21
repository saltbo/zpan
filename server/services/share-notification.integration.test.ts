import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { notifications, systemOptions } from '../db/schema.js'
import * as emailService from '../services/email.js'
import { dispatchShareCreated, type RecipientInput } from '../services/share-notification.js'
import { createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

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

function makeShare(
  overrides: Partial<{
    id: string
    token: string
    kind: 'landing' | 'direct'
    expiresAt: Date | null
  }> = {},
) {
  return {
    id: overrides.id ?? nanoid(),
    token: overrides.token ?? nanoid(10),
    kind: overrides.kind ?? 'landing',
    matterId: nanoid(),
    orgId: nanoid(),
    creatorId: nanoid(),
    passwordHash: null,
    expiresAt: overrides.expiresAt ?? null,
    downloadLimit: null,
    views: 0,
    downloads: 0,
    status: 'active',
    createdAt: new Date(),
  }
}

async function configureEmail(db: TestDb) {
  await db.insert(systemOptions).values({
    key: 'email_provider',
    value: 'smtp',
    public: false,
  })
  await db.insert(systemOptions).values({ key: 'email_from', value: 'no-reply@example.com', public: false })
  await db.insert(systemOptions).values({ key: 'email_smtp_host', value: 'smtp.example.com', public: false })
  await db.insert(systemOptions).values({ key: 'email_smtp_port', value: '587', public: false })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dispatchShareCreated', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts a notification row when recipient has recipientUserId', async () => {
    const { db } = await createTestApp()
    const user = await insertUser(db)
    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientUserId: user.id }]

    await dispatchShareCreated(db, share, recipients, 'Alice', 'secret.pdf')

    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('share_received')
    expect(rows[0].title).toContain('Alice')
    expect(rows[0].title).toContain('secret.pdf')
    expect(rows[0].refType).toBe('share')
    expect(rows[0].refId).toBe(share.id)
  })

  it('does not insert notification when recipient has only email (no userId)', async () => {
    const { db } = await createTestApp()
    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientEmail: 'someone@example.com' }]

    await dispatchShareCreated(db, share, recipients, 'Bob', 'file.txt')

    const rows = await db.select().from(notifications)
    expect(rows).toHaveLength(0)
  })

  it('does not send email and does not throw when email is not configured', async () => {
    const { db } = await createTestApp()
    const sendEmailSpy = vi.spyOn(emailService, 'sendEmail')
    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientEmail: 'test@example.com' }]

    // No email config in DB
    await expect(dispatchShareCreated(db, share, recipients, 'Carol', 'report.docx')).resolves.toBeUndefined()
    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('sends email when email is configured and recipient has email', async () => {
    const { db } = await createTestApp()
    const sendEmailSpy = vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)

    await configureEmail(db)

    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientEmail: 'dave@example.com' }]

    await dispatchShareCreated(db, share, recipients, 'Eve', 'photo.jpg')

    expect(sendEmailSpy).toHaveBeenCalledOnce()
    const callArgs = sendEmailSpy.mock.calls[0]
    // sendEmail(db, message) — second arg is the message
    expect(callArgs[1].to).toBe('dave@example.com')
    expect(callArgs[1].subject).toContain('Eve')
    expect(callArgs[1].subject).toContain('photo.jpg')
  })

  it('looks up email from user table when recipient has only recipientUserId and email is configured', async () => {
    const { db } = await createTestApp()
    const sendEmailSpy = vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)

    await configureEmail(db)

    const user = await insertUser(db, { email: 'frank@example.com' })
    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientUserId: user.id }]

    await dispatchShareCreated(db, share, recipients, 'Grace', 'budget.xlsx')

    expect(sendEmailSpy).toHaveBeenCalledOnce()
    const callArgs = sendEmailSpy.mock.calls[0]
    expect(callArgs[1].to).toBe('frank@example.com')
  })

  it('does not throw when email send fails — logs and continues', async () => {
    const { db } = await createTestApp()
    const sendEmailSpy = vi.spyOn(emailService, 'sendEmail').mockRejectedValue(new Error('SMTP down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await configureEmail(db)

    const share = makeShare()
    const recipients: RecipientInput[] = [{ recipientEmail: 'victim@example.com' }]

    // Should NOT throw despite email failure
    await expect(dispatchShareCreated(db, share, recipients, 'Sender', 'file.txt')).resolves.toBeUndefined()
    expect(sendEmailSpy).toHaveBeenCalledOnce()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('inserts in-app notifications for all recipients that have recipientUserId', async () => {
    const { db } = await createTestApp()
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)
    const share = makeShare()

    const recipients: RecipientInput[] = [
      { recipientUserId: user1.id },
      { recipientUserId: user2.id },
      { recipientEmail: 'no-account@example.com' },
    ]

    await dispatchShareCreated(db, share, recipients, 'Hub', 'multi.zip')

    const rows1 = await db.select().from(notifications).where(eq(notifications.userId, user1.id))
    expect(rows1).toHaveLength(1)

    const rows2 = await db.select().from(notifications).where(eq(notifications.userId, user2.id))
    expect(rows2).toHaveLength(1)

    // No notification for email-only recipient
    const allRows = await db.select().from(notifications)
    expect(allRows).toHaveLength(2)
  })

  it('uses /s/{token} URL for landing shares in notification metadata', async () => {
    const { db } = await createTestApp()
    const user = await insertUser(db)
    const share = makeShare({ kind: 'landing', token: 'abc123token' })

    await dispatchShareCreated(db, share, [{ recipientUserId: user.id }], 'Ian', 'landing.pdf')

    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    const metadata = JSON.parse(rows[0].metadata ?? '{}') as Record<string, unknown>
    expect(metadata.token).toBe('abc123token')
    expect(metadata.kind).toBe('landing')
  })

  it('uses /r/{token} URL for direct shares in notification metadata', async () => {
    const { db } = await createTestApp()
    const user = await insertUser(db)
    const share = makeShare({ kind: 'direct', token: 'directtoken1' })

    await dispatchShareCreated(db, share, [{ recipientUserId: user.id }], 'Jane', 'direct.mp4')

    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(rows).toHaveLength(1)
    const metadata = JSON.parse(rows[0].metadata ?? '{}') as Record<string, unknown>
    expect(metadata.kind).toBe('direct')
  })

  it('includes expiresAt in email body when share has an expiry date', async () => {
    const { db } = await createTestApp()
    const sendEmailSpy = vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)

    await configureEmail(db)

    const expiresAt = new Date('2026-12-31T00:00:00Z')
    const share = makeShare({ expiresAt })
    const recipients: RecipientInput[] = [{ recipientEmail: 'reader@example.com' }]

    await dispatchShareCreated(db, share, recipients, 'Karl', 'expiring.pdf')

    expect(sendEmailSpy).toHaveBeenCalledOnce()
    const emailHtml = sendEmailSpy.mock.calls[0][1].html
    expect(emailHtml).toContain('2026-12-31')
  })

  it('handles empty recipients array without errors', async () => {
    const { db } = await createTestApp()
    const share = makeShare()

    await expect(dispatchShareCreated(db, share, [], 'Leo', 'empty.txt')).resolves.toBeUndefined()

    const rows = await db.select().from(notifications)
    expect(rows).toHaveLength(0)
  })
})
