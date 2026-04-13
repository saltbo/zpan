import { describe, expect, it } from 'vitest'

// Pure logic extracted from the SignIn component:
// identifier is treated as email when it matches a basic email pattern.
function isEmail(identifier: string): boolean {
  return /^[^@]+@[^@]+\.[^@]+$/.test(identifier)
}

describe('sign-in — identifier type detection', () => {
  it('treats valid email as email', () => {
    expect(isEmail('user@example.com')).toBe(true)
  })

  it('treats identifier without @ as username', () => {
    expect(isEmail('myusername')).toBe(false)
  })

  it('treats bare @ as username (not a valid email)', () => {
    expect(isEmail('@')).toBe(false)
  })

  it('treats empty string as username', () => {
    expect(isEmail('')).toBe(false)
  })

  it('treats full email with subdomain as email', () => {
    expect(isEmail('alice@domain.org')).toBe(true)
  })

  it('treats @handle as username (no local part)', () => {
    expect(isEmail('@handle')).toBe(false)
  })

  it('treats user@ as username (no domain)', () => {
    expect(isEmail('user@')).toBe(false)
  })

  it('treats user@domain (no TLD dot) as username', () => {
    expect(isEmail('user@domain')).toBe(false)
  })

  it('treats a plain username with numbers as username', () => {
    expect(isEmail('user123')).toBe(false)
  })

  it('treats a username with underscores as username', () => {
    expect(isEmail('my_user_name')).toBe(false)
  })
})
