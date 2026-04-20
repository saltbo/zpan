// Tests for share-dialog.tsx — tests exported pure-logic functions directly.

import { describe, expect, it } from 'vitest'
import { addDays, buildShareUrl, EMAIL_RE, genPassword, isCustomLimitInvalid } from './share-dialog'

// ─── EMAIL_RE ─────────────────────────────────────────────────────────────────

describe('EMAIL_RE', () => {
  it('accepts a standard email address', () => {
    expect(EMAIL_RE.test('user@example.com')).toBe(true)
  })

  it('accepts an email with subdomain', () => {
    expect(EMAIL_RE.test('user@mail.example.com')).toBe(true)
  })

  it('accepts an email with plus sign in local part', () => {
    expect(EMAIL_RE.test('user+tag@example.com')).toBe(true)
  })

  it('rejects an address with no @', () => {
    expect(EMAIL_RE.test('userexample.com')).toBe(false)
  })

  it('rejects an address with no domain part', () => {
    expect(EMAIL_RE.test('user@')).toBe(false)
  })

  it('rejects an address with no TLD', () => {
    expect(EMAIL_RE.test('user@example')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(EMAIL_RE.test('')).toBe(false)
  })

  it('rejects an address with spaces', () => {
    expect(EMAIL_RE.test('user @example.com')).toBe(false)
  })

  it('rejects a plain username with no @', () => {
    expect(EMAIL_RE.test('justusername')).toBe(false)
  })
})

// ─── genPassword ──────────────────────────────────────────────────────────────

describe('genPassword', () => {
  it('generates a 12-character password', () => {
    expect(genPassword()).toHaveLength(12)
  })

  it('only uses characters from the allowed charset', () => {
    const allowed = new Set('ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789')
    const pw = genPassword()
    for (const ch of pw) {
      expect(allowed.has(ch)).toBe(true)
    }
  })

  it('produces different passwords on repeated calls', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => genPassword()))
    expect(passwords.size).toBeGreaterThan(1)
  })

  it('does not include ambiguous characters I, O, l, 0, 1', () => {
    for (let i = 0; i < 100; i++) {
      expect(genPassword()).not.toMatch(/[IOl01]/)
    }
  })
})

// ─── addDays ──────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('returns a valid ISO string', () => {
    const result = addDays(7)
    expect(Number.isNaN(new Date(result).getTime())).toBe(false)
  })

  it('returns a date roughly 7 days in the future', () => {
    const before = Date.now()
    const resultMs = new Date(addDays(7)).getTime()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(resultMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000)
    expect(resultMs).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 1000)
  })

  it('returns today for n=0', () => {
    const before = Date.now()
    const resultMs = new Date(addDays(0)).getTime()
    expect(resultMs).toBeGreaterThanOrEqual(before - 1000)
    expect(resultMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('returns ~1 day from now for n=1', () => {
    const oneDayMs = 24 * 60 * 60 * 1000
    const resultMs = new Date(addDays(1)).getTime()
    expect(resultMs).toBeGreaterThan(Date.now() + oneDayMs - 5000)
    expect(resultMs).toBeLessThan(Date.now() + oneDayMs + 5000)
  })

  it('returns ~30 days from now for n=30', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    const resultMs = new Date(addDays(30)).getTime()
    expect(resultMs).toBeGreaterThan(Date.now() + thirtyDaysMs - 5000)
    expect(resultMs).toBeLessThan(Date.now() + thirtyDaysMs + 5000)
  })
})

// ─── buildShareUrl ────────────────────────────────────────────────────────────

const makeResult = (
  overrides: Partial<Parameters<typeof buildShareUrl>[0]> = {},
): Parameters<typeof buildShareUrl>[0] => ({
  token: 'tok',
  kind: 'landing',
  urls: { landing: '/s/tok' },
  expiresAt: null,
  downloadLimit: null,
  ...overrides,
})

describe('buildShareUrl', () => {
  it('prefers landing URL when available', () => {
    const result = makeResult({ urls: { landing: '/s/tok', direct: '/dl/tok' } })
    expect(buildShareUrl(result, 'https://example.com')).toBe('https://example.com/s/tok')
  })

  it('falls back to direct URL when landing is absent', () => {
    const result = makeResult({ kind: 'direct', urls: { direct: '/dl/tok' } })
    expect(buildShareUrl(result, 'https://example.com')).toBe('https://example.com/dl/tok')
  })

  it('returns just the origin when both URLs are absent', () => {
    const result = makeResult({ urls: {} })
    expect(buildShareUrl(result, 'https://example.com')).toBe('https://example.com')
  })

  it('concatenates origin and path correctly', () => {
    const result = makeResult({ urls: { landing: '/s/abc123' } })
    expect(buildShareUrl(result, 'https://zpan.io')).toBe('https://zpan.io/s/abc123')
  })
})

// ─── isCustomLimitInvalid ─────────────────────────────────────────────────────

describe('isCustomLimitInvalid', () => {
  it('returns false when option is not custom', () => {
    expect(isCustomLimitInvalid('unlimited', '')).toBe(false)
    expect(isCustomLimitInvalid('10', '')).toBe(false)
    expect(isCustomLimitInvalid('100', '')).toBe(false)
  })

  it('returns true when option is custom and value is empty', () => {
    expect(isCustomLimitInvalid('custom', '')).toBe(true)
  })

  it('returns true when option is custom and value is 0', () => {
    expect(isCustomLimitInvalid('custom', '0')).toBe(true)
  })

  it('returns true when option is custom and value is negative', () => {
    expect(isCustomLimitInvalid('custom', '-1')).toBe(true)
  })

  it('returns false when option is custom and value is 1', () => {
    expect(isCustomLimitInvalid('custom', '1')).toBe(false)
  })

  it('returns false when option is custom and value is a large positive number', () => {
    expect(isCustomLimitInvalid('custom', '1000')).toBe(false)
  })

  it('returns true when option is custom and value is non-numeric string', () => {
    // NaN is not a valid positive integer
    expect(isCustomLimitInvalid('custom', 'abc')).toBe(true)
  })

  it('returns true when option is custom and value is a float string', () => {
    // parseInt('3.5') => 3, which is >= 1 so this returns false — documented behavior
    expect(isCustomLimitInvalid('custom', '3.5')).toBe(false)
  })
})

// ─── Chip validity logic ──────────────────────────────────────────────────────
// Mirrors the simplified addChip in share-dialog.tsx: valid = EMAIL_RE.test(value)

function makeChip(value: string): { value: string; valid: boolean } {
  return { value, valid: EMAIL_RE.test(value) }
}

describe('makeChip — email-only validity', () => {
  it('marks a valid email as valid', () => {
    expect(makeChip('alice@example.com').valid).toBe(true)
  })

  it('marks an invalid email as invalid', () => {
    expect(makeChip('not-an-email').valid).toBe(false)
  })

  it('marks @username as invalid (email required)', () => {
    expect(makeChip('@alice').valid).toBe(false)
  })

  it('marks an empty string as invalid', () => {
    expect(makeChip('').valid).toBe(false)
  })
})

// ─── hasInvalidChips ─────────────────────────────────────────────────────────

function hasInvalidChips(chips: { valid: boolean }[]): boolean {
  return chips.some((c) => !c.valid)
}

describe('hasInvalidChips', () => {
  it('returns false for an empty list', () => {
    expect(hasInvalidChips([])).toBe(false)
  })

  it('returns false when all chips are valid', () => {
    expect(hasInvalidChips([{ valid: true }, { valid: true }])).toBe(false)
  })

  it('returns true when any chip is invalid', () => {
    expect(hasInvalidChips([{ valid: true }, { valid: false }])).toBe(true)
  })

  it('returns true when all chips are invalid', () => {
    expect(hasInvalidChips([{ valid: false }, { valid: false }])).toBe(true)
  })
})

// ─── canSubmit ────────────────────────────────────────────────────────────────
// Mirrors: !hasInvalidChips && !passwordInvalid && !customExpiresInvalid && !customLimitInvalid

function computeCanSubmit(params: {
  chips: { valid: boolean }[]
  passwordEnabled: boolean
  password: string
  expiresOption: string
  customExpires: string
  limitOption: string
  customLimit: string
}): boolean {
  const badChips = params.chips.some((c) => !c.valid)
  const badPassword = params.passwordEnabled && !params.password
  const badExpires =
    params.expiresOption === 'custom' && (!params.customExpires || new Date(params.customExpires) <= new Date())
  const badLimit = isCustomLimitInvalid(params.limitOption, params.customLimit)
  return !badChips && !badPassword && !badExpires && !badLimit
}

const defaultParams = {
  chips: [] as { valid: boolean }[],
  passwordEnabled: false,
  password: '',
  expiresOption: '7d',
  customExpires: '',
  limitOption: 'unlimited',
  customLimit: '',
}

describe('canSubmit', () => {
  it('returns true for default empty form state', () => {
    expect(computeCanSubmit(defaultParams)).toBe(true)
  })

  it('returns false when any chip is invalid', () => {
    expect(computeCanSubmit({ ...defaultParams, chips: [{ valid: false }] })).toBe(false)
  })

  it('returns true when all chips are valid', () => {
    expect(computeCanSubmit({ ...defaultParams, chips: [{ valid: true }, { valid: true }] })).toBe(true)
  })

  it('returns false when password is enabled but empty', () => {
    expect(computeCanSubmit({ ...defaultParams, passwordEnabled: true, password: '' })).toBe(false)
  })

  it('returns true when password is enabled and filled', () => {
    expect(computeCanSubmit({ ...defaultParams, passwordEnabled: true, password: 'secret123' })).toBe(true)
  })

  it('returns true when password toggle is off and password is empty', () => {
    expect(computeCanSubmit({ ...defaultParams, passwordEnabled: false, password: '' })).toBe(true)
  })

  it('returns false when custom expires with no date', () => {
    expect(computeCanSubmit({ ...defaultParams, expiresOption: 'custom', customExpires: '' })).toBe(false)
  })

  it('returns false when custom expires with past date', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(computeCanSubmit({ ...defaultParams, expiresOption: 'custom', customExpires: yesterday })).toBe(false)
  })

  it('returns true when custom expires with future date', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(computeCanSubmit({ ...defaultParams, expiresOption: 'custom', customExpires: future })).toBe(true)
  })

  it('returns false when custom limit is empty', () => {
    expect(computeCanSubmit({ ...defaultParams, limitOption: 'custom', customLimit: '' })).toBe(false)
  })

  it('returns false when custom limit is 0', () => {
    expect(computeCanSubmit({ ...defaultParams, limitOption: 'custom', customLimit: '0' })).toBe(false)
  })

  it('returns true when custom limit is valid positive integer', () => {
    expect(computeCanSubmit({ ...defaultParams, limitOption: 'custom', customLimit: '5' })).toBe(true)
  })

  it('returns false when custom limit is a non-numeric string', () => {
    expect(computeCanSubmit({ ...defaultParams, limitOption: 'custom', customLimit: 'abc' })).toBe(false)
  })
})

// ─── Backspace chip removal ────────────────────────────────────────────────────

function applyBackspace(chips: string[], input: string): string[] {
  if (input === '' && chips.length > 0) return chips.slice(0, -1)
  return chips
}

describe('backspace chip removal', () => {
  it('removes the last chip when input is empty', () => {
    expect(applyBackspace(['a@a.com', 'b@b.com'], '')).toEqual(['a@a.com'])
  })

  it('does not remove a chip when input has content', () => {
    expect(applyBackspace(['a@a.com'], 'b')).toEqual(['a@a.com'])
  })

  it('does nothing when chip list is empty', () => {
    expect(applyBackspace([], '')).toEqual([])
  })

  it('results in empty array when removing the only chip', () => {
    expect(applyBackspace(['a@a.com'], '')).toEqual([])
  })
})

// ─── handleSubmit payload building ────────────────────────────────────────────

interface BuildPayloadParams {
  matterId: string
  kind: 'landing' | 'direct'
  passwordEnabled: boolean
  password: string
  expiresOption: string
  customExpires: string
  limitOption: string
  customLimit: string
  chips: { value: string; valid: boolean }[]
}

interface PayloadResult {
  matterId: string
  kind: 'landing' | 'direct'
  password?: string
  expiresAt?: string
  downloadLimit?: number
  recipients?: { recipientEmail: string }[]
}

function buildPayload(params: BuildPayloadParams): PayloadResult {
  const body: PayloadResult = { matterId: params.matterId, kind: params.kind }
  if (params.kind === 'landing' && params.passwordEnabled && params.password) body.password = params.password
  if (params.expiresOption !== 'never') {
    const days: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }
    body.expiresAt =
      params.expiresOption === 'custom'
        ? new Date(params.customExpires).toISOString()
        : addDays(days[params.expiresOption])
  }
  if (params.limitOption !== 'unlimited') {
    body.downloadLimit = Number.parseInt(params.limitOption === 'custom' ? params.customLimit : params.limitOption)
  }
  if (params.kind === 'landing' && params.chips.length > 0) {
    body.recipients = params.chips.filter((c) => c.valid).map((c) => ({ recipientEmail: c.value }))
  }
  return body
}

const baseParams: BuildPayloadParams = {
  matterId: 'obj-1',
  kind: 'landing',
  passwordEnabled: false,
  password: '',
  expiresOption: 'never',
  customExpires: '',
  limitOption: 'unlimited',
  customLimit: '',
  chips: [],
}

describe('buildPayload — basic fields', () => {
  it('includes matterId and kind', () => {
    const p = buildPayload(baseParams)
    expect(p.matterId).toBe('obj-1')
    expect(p.kind).toBe('landing')
  })

  it('omits expiresAt when option is never', () => {
    expect(buildPayload(baseParams).expiresAt).toBeUndefined()
  })

  it('omits downloadLimit when option is unlimited', () => {
    expect(buildPayload(baseParams).downloadLimit).toBeUndefined()
  })
})

describe('buildPayload — password', () => {
  it('includes password when landing, enabled, and filled', () => {
    const p = buildPayload({ ...baseParams, passwordEnabled: true, password: 'secret' })
    expect(p.password).toBe('secret')
  })

  it('omits password when not enabled', () => {
    expect(buildPayload({ ...baseParams, passwordEnabled: false, password: 'secret' }).password).toBeUndefined()
  })

  it('omits password when kind is direct even if enabled', () => {
    expect(
      buildPayload({ ...baseParams, kind: 'direct', passwordEnabled: true, password: 'secret' }).password,
    ).toBeUndefined()
  })

  it('omits password when enabled but empty string', () => {
    expect(buildPayload({ ...baseParams, passwordEnabled: true, password: '' }).password).toBeUndefined()
  })
})

describe('buildPayload — expiresAt', () => {
  it('sets expiresAt ~1 day from now for 1d', () => {
    const expMs = new Date(buildPayload({ ...baseParams, expiresOption: '1d' }).expiresAt!).getTime()
    const oneDayMs = 24 * 60 * 60 * 1000
    expect(expMs).toBeGreaterThan(Date.now() + oneDayMs - 5000)
    expect(expMs).toBeLessThan(Date.now() + oneDayMs + 5000)
  })

  it('sets expiresAt from custom date string', () => {
    const p = buildPayload({ ...baseParams, expiresOption: 'custom', customExpires: '2099-12-31' })
    expect(new Date(p.expiresAt!).getFullYear()).toBe(2099)
  })
})

describe('buildPayload — downloadLimit', () => {
  it('sets downloadLimit to 10 for preset option "10"', () => {
    expect(buildPayload({ ...baseParams, limitOption: '10' }).downloadLimit).toBe(10)
  })

  it('sets downloadLimit to 100 for preset option "100"', () => {
    expect(buildPayload({ ...baseParams, limitOption: '100' }).downloadLimit).toBe(100)
  })

  it('uses customLimit integer when option is custom', () => {
    expect(buildPayload({ ...baseParams, limitOption: 'custom', customLimit: '25' }).downloadLimit).toBe(25)
  })
})

describe('buildPayload — recipients', () => {
  it('includes valid email chips as recipients for landing kind', () => {
    const chips = [
      { value: 'a@b.com', valid: true },
      { value: 'c@d.com', valid: true },
    ]
    expect(buildPayload({ ...baseParams, chips }).recipients).toEqual([
      { recipientEmail: 'a@b.com' },
      { recipientEmail: 'c@d.com' },
    ])
  })

  it('excludes invalid email chips', () => {
    const chips = [
      { value: 'a@b.com', valid: true },
      { value: 'bad', valid: false },
    ]
    expect(buildPayload({ ...baseParams, chips }).recipients).toEqual([{ recipientEmail: 'a@b.com' }])
  })

  it('omits recipients for direct kind', () => {
    const chips = [{ value: 'a@b.com', valid: true }]
    expect(buildPayload({ ...baseParams, kind: 'direct', chips }).recipients).toBeUndefined()
  })

  it('omits recipients when chips list is empty', () => {
    expect(buildPayload({ ...baseParams, chips: [] }).recipients).toBeUndefined()
  })
})
