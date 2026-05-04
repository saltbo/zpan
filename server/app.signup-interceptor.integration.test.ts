/**
 * Focused tests for the Hono sign-up audit interceptor in server/app.ts.
 *
 * These tests verify the fail-fast behaviour added to the sign-up interceptor:
 * if a successful sign-up cannot be audited due to invariant violations the
 * request must fail (5xx) rather than silently losing audit rows.
 *
 * Tests that require invariant violations use vi.mock to control findPersonalOrg
 * so they must live in a separate file from the happy-path integration tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp } from './test/setup.js'

vi.mock('./services/s3.js', () => {
  const S3Service = vi.fn()
  S3Service.prototype.presignUpload = vi.fn().mockResolvedValue('https://s3.example.com/upload?sig=REDACTED')
  S3Service.prototype.presignDownload = vi.fn().mockResolvedValue('https://s3.example.com/download?sig=REDACTED')
  S3Service.prototype.deleteObject = vi.fn().mockResolvedValue(undefined)
  S3Service.prototype.deleteObjects = vi.fn().mockResolvedValue(undefined)
  S3Service.prototype.copyObject = vi.fn().mockResolvedValue(undefined)
  return { S3Service }
})

vi.mock('./services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  getEmailConfig: vi.fn().mockResolvedValue({ host: 'smtp.test', port: 587, user: 'u', pass: 'p', from: 'f' }),
  isEmailConfigured: vi.fn().mockResolvedValue(false),
}))

// Mock findPersonalOrg to simulate the invariant violation where sign-up
// succeeds but the personal org cannot be located in the database.
vi.mock('./services/org.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/org.js')>()
  return {
    ...actual,
    // Replaced per-test via vi.spyOn; defaults to the real implementation.
    findPersonalOrg: actual.findPersonalOrg,
  }
})

describe('sign-up audit interceptor — fail-fast invariants', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic mock replacement
  let orgModule: any

  beforeEach(async () => {
    orgModule = await import('./services/org.js')
    vi.restoreAllMocks()
  })

  it('fails the request when sign-up succeeds but personal org is not found', async () => {
    // Simulate the invariant: auth creates the user successfully but our
    // interceptor's findPersonalOrg call returns null (e.g. race condition
    // or missing org row after user.create.after failure).
    vi.spyOn(orgModule, 'findPersonalOrg').mockResolvedValue(null)

    const { app } = await createTestApp()

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invariant User',
        email: 'invariant-orgid@example.com',
        password: 'password123456',
      }),
    })

    // The interceptor must fail the request rather than silently dropping
    // the audit row — the response status must indicate server-side failure.
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('returns 200 on normal sign-up when org is found (happy path)', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Happy User',
        email: 'happy-interceptor@example.com',
        password: 'password123456',
      }),
    })

    expect(res.status).toBe(200)
  })
})
