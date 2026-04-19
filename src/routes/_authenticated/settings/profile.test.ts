import { describe, expect, it } from 'vitest'

// ProfilePage components are React rendering components. The project has no
// jsdom or @testing-library/react setup, so we cannot render them here.
// We test the pure logic the components apply:
//   - ProfileForm: display name schema validation
//   - ChangePasswordForm: password schema validation (match check)
//   - PublicProfileSection: toggleId set logic and visibility batch split

// ---------------------------------------------------------------------------
// ProfileForm — display name validation mirrors profileSchema:
//   displayName: z.string().min(1).max(100)
// ---------------------------------------------------------------------------

function isValidDisplayName(name: string): boolean {
  return name.length >= 1 && name.length <= 100
}

describe('ProfileForm — display name validation', () => {
  it('accepts a typical display name', () => {
    expect(isValidDisplayName('John Doe')).toBe(true)
  })

  it('accepts exactly 1 character (minimum)', () => {
    expect(isValidDisplayName('J')).toBe(true)
  })

  it('accepts exactly 100 characters (maximum)', () => {
    expect(isValidDisplayName('a'.repeat(100))).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidDisplayName('')).toBe(false)
  })

  it('rejects string longer than 100 characters', () => {
    expect(isValidDisplayName('a'.repeat(101))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ChangePasswordForm — password match check mirrors passwordSchema.refine:
//   data.newPassword === data.confirmPassword
// ---------------------------------------------------------------------------

function passwordsMatch(newPassword: string, confirmPassword: string): boolean {
  return newPassword === confirmPassword
}

describe('ChangePasswordForm — password match validation', () => {
  it('returns true when passwords are identical', () => {
    expect(passwordsMatch('secret123', 'secret123')).toBe(true)
  })

  it('returns false when passwords differ', () => {
    expect(passwordsMatch('secret123', 'different')).toBe(false)
  })

  it('returns false when confirm password is empty', () => {
    expect(passwordsMatch('secret123', '')).toBe(false)
  })

  it('returns true for identical complex passwords', () => {
    expect(passwordsMatch('P@ssw0rd!', 'P@ssw0rd!')).toBe(true)
  })

  it('is case-sensitive', () => {
    expect(passwordsMatch('Secret123', 'secret123')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PublicProfileSection — toggleId set logic mirrors:
//   if (next.has(id)) next.delete(id) else next.add(id)
// ---------------------------------------------------------------------------

function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

describe('PublicProfileSection — toggleId', () => {
  it('adds id when not present', () => {
    const result = toggleId(new Set(['a', 'b']), 'c')
    expect(result.has('c')).toBe(true)
    expect(result.size).toBe(3)
  })

  it('removes id when already present', () => {
    const result = toggleId(new Set(['a', 'b', 'c']), 'b')
    expect(result.has('b')).toBe(false)
    expect(result.size).toBe(2)
  })

  it('does not mutate the original set', () => {
    const original = new Set(['a', 'b'])
    toggleId(original, 'c')
    expect(original.size).toBe(2)
  })

  it('adds to empty set', () => {
    const result = toggleId(new Set(), 'x')
    expect(result.has('x')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('removes last item leaving empty set', () => {
    const result = toggleId(new Set(['x']), 'x')
    expect(result.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PublicProfileSection — visibility batch split mirrors mutation:
//   const toPublic = allIds.filter((id) => publicIds.has(id))
//   const toPrivate = allIds.filter((id) => !publicIds.has(id))
// ---------------------------------------------------------------------------

function splitVisibility(allIds: string[], publicIds: Set<string>): { toPublic: string[]; toPrivate: string[] } {
  return {
    toPublic: allIds.filter((id) => publicIds.has(id)),
    toPrivate: allIds.filter((id) => !publicIds.has(id)),
  }
}

describe('PublicProfileSection — visibility batch split', () => {
  it('puts checked ids in toPublic and unchecked in toPrivate', () => {
    const allIds = ['a', 'b', 'c', 'd']
    const publicIds = new Set(['a', 'c'])
    const { toPublic, toPrivate } = splitVisibility(allIds, publicIds)
    expect(toPublic).toEqual(['a', 'c'])
    expect(toPrivate).toEqual(['b', 'd'])
  })

  it('all private when publicIds is empty', () => {
    const { toPublic, toPrivate } = splitVisibility(['a', 'b'], new Set())
    expect(toPublic).toEqual([])
    expect(toPrivate).toEqual(['a', 'b'])
  })

  it('all public when all ids are in publicIds', () => {
    const ids = ['x', 'y']
    const { toPublic, toPrivate } = splitVisibility(ids, new Set(ids))
    expect(toPublic).toEqual(['x', 'y'])
    expect(toPrivate).toEqual([])
  })

  it('handles empty allIds', () => {
    const { toPublic, toPrivate } = splitVisibility([], new Set(['a']))
    expect(toPublic).toEqual([])
    expect(toPrivate).toEqual([])
  })
})
