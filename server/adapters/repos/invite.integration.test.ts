import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../test/setup.js'
import { createInviteRepo } from './invite.js'

describe('generateInviteCodes', () => {
  it('returns the requested number of codes', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 5)
    expect(codes).toHaveLength(5)
  })

  it('returns one code when count is 1', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 1)
    expect(codes).toHaveLength(1)
  })

  it('generates unique codes for each entry', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 10)
    const uniqueCodes = new Set(codes.map((c) => c.code))
    expect(uniqueCodes.size).toBe(10)
  })

  it('each code has a 10-character Base62 code field', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 3)
    for (const code of codes) {
      expect(code.code).toMatch(/^[A-Za-z0-9]{10}$/)
    }
  })

  it('sets createdBy to the provided admin user id on all codes', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-42', 3)
    for (const code of codes) {
      expect(code.createdBy).toBe('admin-42')
    }
  })

  it('sets usedBy and usedAt to null on fresh codes', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 2)
    for (const code of codes) {
      expect(code.usedBy).toBeNull()
      expect(code.usedAt).toBeNull()
    }
  })

  it('sets expiresAt to null when not provided', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 2)
    for (const code of codes) {
      expect(code.expiresAt).toBeNull()
    }
  })

  it('propagates expiresAt to all generated codes', async () => {
    const { db } = await createTestApp()
    const expiry = new Date(Date.now() + 86400000)
    const codes = await createInviteRepo(db).generate('admin-1', 3, expiry)
    for (const code of codes) {
      expect(code.expiresAt).not.toBeNull()
    }
  })

  it('persists codes to the database', async () => {
    const { db } = await createTestApp()
    const codes = await createInviteRepo(db).generate('admin-1', 2)
    for (const code of codes) {
      const result = await createInviteRepo(db).validate(code.code)
      expect(result.valid).toBe(true)
    }
  })
})

describe('validateInviteCode', () => {
  it('returns valid:true for an unused, unexpired code', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    const result = await createInviteRepo(db).validate(row.code)
    expect(result).toEqual({ valid: true })
  })

  it('returns valid:false with an error for a nonexistent code', async () => {
    const { db } = await createTestApp()
    const result = await createInviteRepo(db).validate('NOSUCHCODE1')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:false with an error for a used code', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-99')
    const result = await createInviteRepo(db).validate(row.code)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:false with an error for an expired code', async () => {
    const { db } = await createTestApp()
    const pastDate = new Date(Date.now() - 1000)
    const [row] = await createInviteRepo(db).generate('admin-1', 1, pastDate)
    const result = await createInviteRepo(db).validate(row.code)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:true for a code that has not yet expired', async () => {
    const { db } = await createTestApp()
    const futureDate = new Date(Date.now() + 86400000)
    const [row] = await createInviteRepo(db).generate('admin-1', 1, futureDate)
    const result = await createInviteRepo(db).validate(row.code)
    expect(result.valid).toBe(true)
  })
})

describe('redeemInviteCode', () => {
  it('returns ok when redeeming a valid unused code', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    const result = await createInviteRepo(db).redeem(row.code, 'user-55')
    expect(result).toBe('ok')
  })

  it('marks the code as used so it cannot be validated again', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-55')
    const check = await createInviteRepo(db).validate(row.code)
    expect(check.valid).toBe(false)
  })

  it('returns not_found for a nonexistent code', async () => {
    const { db } = await createTestApp()
    const result = await createInviteRepo(db).redeem('NOSUCHCODE1', 'user-55')
    expect(result).toBe('not_found')
  })

  it('returns already_used when redeeming a previously redeemed code', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-55')
    const result = await createInviteRepo(db).redeem(row.code, 'user-99')
    expect(result).toBe('already_used')
  })

  it('returns expired for an expired code', async () => {
    const { db } = await createTestApp()
    const pastDate = new Date(Date.now() - 1000)
    const [row] = await createInviteRepo(db).generate('admin-1', 1, pastDate)
    const result = await createInviteRepo(db).redeem(row.code, 'user-55')
    expect(result).toBe('expired')
  })

  it('sets usedAt to a non-null timestamp after redemption', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-55')
    const check = await createInviteRepo(db).validate(row.code)
    expect(check.error).toContain('used')
  })
})

describe('listInviteCodes', () => {
  it('returns an empty page without a next boundary when no codes exist', async () => {
    const { db } = await createTestApp()
    const result = await createInviteRepo(db).list({ pageSize: 20 })
    expect(result).toEqual({ items: [], nextBoundary: null })
  })

  it('returns all codes without a next boundary when fewer than pageSize', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 3)
    const result = await createInviteRepo(db).list({ pageSize: 20 })
    expect(result.items).toHaveLength(3)
    expect(result.nextBoundary).toBeNull()
  })

  it('has no next boundary when the page is exactly full', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 3)
    const result = await createInviteRepo(db).list({ pageSize: 3 })
    expect(result.items).toHaveLength(3)
    expect(result.nextBoundary).toBeNull()
  })

  it('returns a boundary of the last visible row when more rows exist', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 5)
    const result = await createInviteRepo(db).list({ pageSize: 3 })
    expect(result.items).toHaveLength(3)
    const last = result.items[2]
    expect(result.nextBoundary).toEqual({ createdAt: last.createdAt, id: last.id })
  })

  it('walks every code exactly once across pages, even when createdAt ties', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 7)
    const seen: string[] = []
    let after: { createdAt: Date; id: string } | undefined
    for (let i = 0; i < 10; i++) {
      const page = await createInviteRepo(db).list({ pageSize: 3, after })
      seen.push(...page.items.map((item) => item.id))
      if (!page.nextBoundary) break
      after = page.nextBoundary
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
    const all = await createInviteRepo(db).list({ pageSize: 20 })
    expect(seen).toEqual(all.items.map((item) => item.id))
  })

  it('returns an empty page after the oldest boundary', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 2)
    const all = await createInviteRepo(db).list({ pageSize: 20 })
    const oldest = all.items[all.items.length - 1]
    const result = await createInviteRepo(db).list({
      pageSize: 20,
      after: { createdAt: oldest.createdAt, id: oldest.id },
    })
    expect(result).toEqual({ items: [], nextBoundary: null })
  })

  it('orders results by createdAt descending', async () => {
    const { db } = await createTestApp()
    await createInviteRepo(db).generate('admin-1', 3)
    const result = await createInviteRepo(db).list({ pageSize: 20 })
    const timestamps = result.items.map((item) => item.createdAt.getTime())
    const sorted = [...timestamps].sort((a, b) => b - a)
    expect(timestamps).toEqual(sorted)
  })
})

describe('deleteInviteCode', () => {
  it('returns ok and removes the code when it exists and is unused', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    const result = await createInviteRepo(db).delete(row.id)
    expect(result).toBe('ok')
  })

  it('removes the code from the database after deletion', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).delete(row.id)
    const check = await createInviteRepo(db).validate(row.code)
    expect(check.valid).toBe(false)
  })

  it('returns not_found for a nonexistent code id', async () => {
    const { db } = await createTestApp()
    const result = await createInviteRepo(db).delete('NOSUCHID')
    expect(result).toBe('not_found')
  })

  it('returns already_used for a code that has been redeemed', async () => {
    const { db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-99')
    const result = await createInviteRepo(db).delete(row.id)
    expect(result).toBe('already_used')
  })
})
