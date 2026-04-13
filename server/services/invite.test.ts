import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import {
  deleteInviteCode,
  generateInviteCodes,
  listInviteCodes,
  redeemInviteCode,
  validateInviteCode,
} from './invite.js'

describe('generateInviteCodes', () => {
  it('returns the requested number of codes', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 5)
    expect(codes).toHaveLength(5)
  })

  it('returns one code when count is 1', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 1)
    expect(codes).toHaveLength(1)
  })

  it('generates unique codes for each entry', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 10)
    const uniqueCodes = new Set(codes.map((c) => c.code))
    expect(uniqueCodes.size).toBe(10)
  })

  it('each code has an 8-character uppercase alphanumeric code field', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 3)
    for (const code of codes) {
      expect(code.code).toMatch(/^[0-9A-Z]{8}$/)
    }
  })

  it('sets createdBy to the provided admin user id on all codes', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-42', 3)
    for (const code of codes) {
      expect(code.createdBy).toBe('admin-42')
    }
  })

  it('sets usedBy and usedAt to null on fresh codes', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 2)
    for (const code of codes) {
      expect(code.usedBy).toBeNull()
      expect(code.usedAt).toBeNull()
    }
  })

  it('sets expiresAt to null when not provided', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 2)
    for (const code of codes) {
      expect(code.expiresAt).toBeNull()
    }
  })

  it('propagates expiresAt to all generated codes', async () => {
    const { db } = await createTestApp()
    const expiry = new Date(Date.now() + 86400000)
    const codes = await generateInviteCodes(db, 'admin-1', 3, expiry)
    for (const code of codes) {
      expect(code.expiresAt).not.toBeNull()
    }
  })

  it('persists codes to the database', async () => {
    const { db } = await createTestApp()
    const codes = await generateInviteCodes(db, 'admin-1', 2)
    for (const code of codes) {
      const result = await validateInviteCode(db, code.code)
      expect(result.valid).toBe(true)
    }
  })
})

describe('validateInviteCode', () => {
  it('returns valid:true for an unused, unexpired code', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    const result = await validateInviteCode(db, row.code)
    expect(result).toEqual({ valid: true })
  })

  it('returns valid:false with an error for a nonexistent code', async () => {
    const { db } = await createTestApp()
    const result = await validateInviteCode(db, 'NOSUCHCD')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:false with an error for a used code', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await redeemInviteCode(db, row.code, 'user-99')
    const result = await validateInviteCode(db, row.code)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:false with an error for an expired code', async () => {
    const { db } = await createTestApp()
    const pastDate = new Date(Date.now() - 1000)
    const [row] = await generateInviteCodes(db, 'admin-1', 1, pastDate)
    const result = await validateInviteCode(db, row.code)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns valid:true for a code that has not yet expired', async () => {
    const { db } = await createTestApp()
    const futureDate = new Date(Date.now() + 86400000)
    const [row] = await generateInviteCodes(db, 'admin-1', 1, futureDate)
    const result = await validateInviteCode(db, row.code)
    expect(result.valid).toBe(true)
  })
})

describe('redeemInviteCode', () => {
  it('returns ok when redeeming a valid unused code', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    const result = await redeemInviteCode(db, row.code, 'user-55')
    expect(result).toBe('ok')
  })

  it('marks the code as used so it cannot be validated again', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await redeemInviteCode(db, row.code, 'user-55')
    const check = await validateInviteCode(db, row.code)
    expect(check.valid).toBe(false)
  })

  it('returns not_found for a nonexistent code', async () => {
    const { db } = await createTestApp()
    const result = await redeemInviteCode(db, 'NOSUCHCD', 'user-55')
    expect(result).toBe('not_found')
  })

  it('returns already_used when redeeming a previously redeemed code', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await redeemInviteCode(db, row.code, 'user-55')
    const result = await redeemInviteCode(db, row.code, 'user-99')
    expect(result).toBe('already_used')
  })

  it('returns expired for an expired code', async () => {
    const { db } = await createTestApp()
    const pastDate = new Date(Date.now() - 1000)
    const [row] = await generateInviteCodes(db, 'admin-1', 1, pastDate)
    const result = await redeemInviteCode(db, row.code, 'user-55')
    expect(result).toBe('expired')
  })

  it('sets usedAt to a non-null timestamp after redemption', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await redeemInviteCode(db, row.code, 'user-55')
    const check = await validateInviteCode(db, row.code)
    expect(check.error).toContain('used')
  })
})

describe('listInviteCodes', () => {
  it('returns empty items and total 0 when no codes exist', async () => {
    const { db } = await createTestApp()
    const result = await listInviteCodes(db, 1, 20)
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns all codes when fewer than pageSize', async () => {
    const { db } = await createTestApp()
    await generateInviteCodes(db, 'admin-1', 3)
    const result = await listInviteCodes(db, 1, 20)
    expect(result.total).toBe(3)
    expect(result.items).toHaveLength(3)
  })

  it('paginates correctly — page 1 returns first pageSize items', async () => {
    const { db } = await createTestApp()
    await generateInviteCodes(db, 'admin-1', 5)
    const result = await listInviteCodes(db, 1, 3)
    expect(result.total).toBe(5)
    expect(result.items).toHaveLength(3)
  })

  it('paginates correctly — page 2 returns remaining items', async () => {
    const { db } = await createTestApp()
    await generateInviteCodes(db, 'admin-1', 5)
    const result = await listInviteCodes(db, 2, 3)
    expect(result.total).toBe(5)
    expect(result.items).toHaveLength(2)
  })

  it('returns empty items on a page beyond total count', async () => {
    const { db } = await createTestApp()
    await generateInviteCodes(db, 'admin-1', 2)
    const result = await listInviteCodes(db, 5, 20)
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(0)
  })

  it('orders results by createdAt descending', async () => {
    const { db } = await createTestApp()
    await generateInviteCodes(db, 'admin-1', 3)
    const result = await listInviteCodes(db, 1, 20)
    const timestamps = result.items.map((item) => item.createdAt.getTime())
    const sorted = [...timestamps].sort((a, b) => b - a)
    expect(timestamps).toEqual(sorted)
  })
})

describe('deleteInviteCode', () => {
  it('returns ok and removes the code when it exists and is unused', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    const result = await deleteInviteCode(db, row.id)
    expect(result).toBe('ok')
  })

  it('removes the code from the database after deletion', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await deleteInviteCode(db, row.id)
    const check = await validateInviteCode(db, row.code)
    expect(check.valid).toBe(false)
  })

  it('returns not_found for a nonexistent code id', async () => {
    const { db } = await createTestApp()
    const result = await deleteInviteCode(db, 'NOSUCHID')
    expect(result).toBe('not_found')
  })

  it('returns already_used for a code that has been redeemed', async () => {
    const { db } = await createTestApp()
    const [row] = await generateInviteCodes(db, 'admin-1', 1)
    await redeemInviteCode(db, row.code, 'user-99')
    const result = await deleteInviteCode(db, row.id)
    expect(result).toBe('already_used')
  })
})
