import { describe, expect, it } from 'vitest'

// Pure logic extracted from the SignUp component:
// Username must match /^[a-zA-Z0-9_]{3,30}$/
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/

describe('sign-up — username validation regex', () => {
  describe('valid usernames', () => {
    it('accepts a 3-character username', () => {
      expect(USERNAME_RE.test('abc')).toBe(true)
    })

    it('accepts a 30-character username', () => {
      expect(USERNAME_RE.test('a'.repeat(30))).toBe(true)
    })

    it('accepts a username with only letters', () => {
      expect(USERNAME_RE.test('alice')).toBe(true)
    })

    it('accepts a username with only digits', () => {
      expect(USERNAME_RE.test('123')).toBe(true)
    })

    it('accepts a username with only underscores', () => {
      expect(USERNAME_RE.test('___')).toBe(true)
    })

    it('accepts a username mixing letters, digits, and underscores', () => {
      expect(USERNAME_RE.test('my_user_42')).toBe(true)
    })

    it('accepts uppercase letters', () => {
      expect(USERNAME_RE.test('Alice')).toBe(true)
    })

    it('accepts all uppercase', () => {
      expect(USERNAME_RE.test('BOB')).toBe(true)
    })

    it('accepts a username starting with underscore', () => {
      expect(USERNAME_RE.test('_handle')).toBe(true)
    })
  })

  describe('invalid usernames', () => {
    it('rejects a 2-character username (too short)', () => {
      expect(USERNAME_RE.test('ab')).toBe(false)
    })

    it('rejects a 31-character username (too long)', () => {
      expect(USERNAME_RE.test('a'.repeat(31))).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(USERNAME_RE.test('')).toBe(false)
    })

    it('rejects a username with a space', () => {
      expect(USERNAME_RE.test('my user')).toBe(false)
    })

    it('rejects a username with a hyphen', () => {
      expect(USERNAME_RE.test('my-user')).toBe(false)
    })

    it('rejects a username with an @ symbol', () => {
      expect(USERNAME_RE.test('user@name')).toBe(false)
    })

    it('rejects a username with a dot', () => {
      expect(USERNAME_RE.test('user.name')).toBe(false)
    })

    it('rejects a username with special characters', () => {
      expect(USERNAME_RE.test('user!name')).toBe(false)
    })

    it('rejects a single character username', () => {
      expect(USERNAME_RE.test('a')).toBe(false)
    })
  })

  describe('boundary conditions', () => {
    it('accepts exactly 3 characters', () => {
      expect(USERNAME_RE.test('xyz')).toBe(true)
    })

    it('accepts exactly 30 characters', () => {
      expect(USERNAME_RE.test('abcdefghij0123456789abcdefghij')).toBe(true)
    })

    it('rejects exactly 2 characters', () => {
      expect(USERNAME_RE.test('xy')).toBe(false)
    })

    it('rejects exactly 31 characters', () => {
      expect(USERNAME_RE.test('abcdefghij0123456789abcdefghij1')).toBe(false)
    })
  })
})
