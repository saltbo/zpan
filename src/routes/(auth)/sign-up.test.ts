import { SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// Tests for sign-up page pure logic.
// USERNAME_PATTERN is the module-level constant from sign-up.tsx — replicated here
// to test the contract: alphanumeric + underscore, 3–30 characters.
//
// The invite code inclusion logic is also tested as a pure function to cover
// the conditional that controls whether inviteCode is sent to the API.

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/

describe('USERNAME_PATTERN validation', () => {
  describe('valid usernames', () => {
    it('accepts a simple lowercase alphabetic username', () => {
      expect(USERNAME_PATTERN.test('alice')).toBe(true)
    })

    it('accepts a username with uppercase letters', () => {
      expect(USERNAME_PATTERN.test('Alice')).toBe(true)
    })

    it('accepts a username with digits', () => {
      expect(USERNAME_PATTERN.test('user123')).toBe(true)
    })

    it('accepts a username with underscores', () => {
      expect(USERNAME_PATTERN.test('user_name')).toBe(true)
    })

    it('accepts a username of exactly 3 characters', () => {
      expect(USERNAME_PATTERN.test('abc')).toBe(true)
    })

    it('accepts a username of exactly 30 characters', () => {
      expect(USERNAME_PATTERN.test('a'.repeat(30))).toBe(true)
    })

    it('accepts a mixed-case username with digits and underscores', () => {
      expect(USERNAME_PATTERN.test('John_Doe_42')).toBe(true)
    })

    it('accepts an all-digit username of minimum length', () => {
      expect(USERNAME_PATTERN.test('123')).toBe(true)
    })

    it('accepts an all-underscore username of minimum length', () => {
      expect(USERNAME_PATTERN.test('___')).toBe(true)
    })
  })

  describe('invalid usernames', () => {
    it('rejects an empty string', () => {
      expect(USERNAME_PATTERN.test('')).toBe(false)
    })

    it('rejects a username of 1 character', () => {
      expect(USERNAME_PATTERN.test('a')).toBe(false)
    })

    it('rejects a username of 2 characters', () => {
      expect(USERNAME_PATTERN.test('ab')).toBe(false)
    })

    it('rejects a username of 31 characters', () => {
      expect(USERNAME_PATTERN.test('a'.repeat(31))).toBe(false)
    })

    it('rejects a username with a hyphen', () => {
      expect(USERNAME_PATTERN.test('user-name')).toBe(false)
    })

    it('rejects a username with a dot', () => {
      expect(USERNAME_PATTERN.test('user.name')).toBe(false)
    })

    it('rejects a username with spaces', () => {
      expect(USERNAME_PATTERN.test('user name')).toBe(false)
    })

    it('rejects a username with an @ symbol', () => {
      expect(USERNAME_PATTERN.test('user@name')).toBe(false)
    })

    it('rejects a username with special characters', () => {
      expect(USERNAME_PATTERN.test('user#name')).toBe(false)
    })

    it('rejects a username with a leading space', () => {
      expect(USERNAME_PATTERN.test(' abc')).toBe(false)
    })

    it('rejects a username with a trailing space', () => {
      expect(USERNAME_PATTERN.test('abc ')).toBe(false)
    })
  })
})

describe('sign-up invite code inclusion logic', () => {
  // Replicates the conditional from handleSubmit:
  // ...(authSignupMode === SignupMode.INVITE_ONLY && inviteCode ? { inviteCode } : {})

  function buildSignUpPayload(authSignupMode: string, inviteCode: string) {
    return {
      username: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      password: 'secret',
      callbackURL: '/files',
      ...(authSignupMode === SignupMode.INVITE_ONLY && inviteCode ? { inviteCode } : {}),
    }
  }

  it('includes inviteCode when mode is invite_only and code is provided', () => {
    const payload = buildSignUpPayload(SignupMode.INVITE_ONLY, 'CODE123')

    expect(payload).toHaveProperty('inviteCode', 'CODE123')
  })

  it('omits inviteCode when mode is invite_only but code is empty', () => {
    const payload = buildSignUpPayload(SignupMode.INVITE_ONLY, '')

    expect(payload).not.toHaveProperty('inviteCode')
  })

  it('omits inviteCode when mode is open even if code is provided', () => {
    const payload = buildSignUpPayload(SignupMode.OPEN, 'CODE123')

    expect(payload).not.toHaveProperty('inviteCode')
  })

  it('omits inviteCode when mode is closed even if code is provided', () => {
    const payload = buildSignUpPayload(SignupMode.CLOSED, 'CODE123')

    expect(payload).not.toHaveProperty('inviteCode')
  })

  it('always includes base fields regardless of mode', () => {
    const payload = buildSignUpPayload(SignupMode.OPEN, '')

    expect(payload).toMatchObject({
      username: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      password: 'secret',
      callbackURL: '/files',
    })
  })
})
