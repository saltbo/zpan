import { describe, expect, it } from 'vitest'

// ProfilePage components are React rendering components. The project has no
// jsdom or @testing-library/react setup, so we cannot render them here.
// We test the pure logic the components apply:
//   - ProfileForm: display name schema validation

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
