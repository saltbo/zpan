import { describe, expect, it } from 'vitest'

// Tests for the sign-in identifier detection logic.
// The sign-in form auto-detects whether the user typed an email or a username
// by checking for the presence of '@'. This logic is the public contract
// of the sign-in route's credential routing.

function detectIdentifierType(identifier: string): 'email' | 'username' {
  return identifier.includes('@') ? 'email' : 'username'
}

describe('sign-in identifier detection', () => {
  describe('email detection', () => {
    it('classifies a standard email as email', () => {
      expect(detectIdentifierType('user@example.com')).toBe('email')
    })

    it('classifies an email with subdomain as email', () => {
      expect(detectIdentifierType('user@mail.example.com')).toBe('email')
    })

    it('classifies an email with plus addressing as email', () => {
      expect(detectIdentifierType('user+tag@example.com')).toBe('email')
    })

    it('classifies a bare @ symbol as email', () => {
      expect(detectIdentifierType('@')).toBe('email')
    })

    it('classifies a string starting with @ as email', () => {
      expect(detectIdentifierType('@username')).toBe('email')
    })

    it('classifies a string ending with @ as email', () => {
      expect(detectIdentifierType('user@')).toBe('email')
    })
  })

  describe('username detection', () => {
    it('classifies a simple alphanumeric string as username', () => {
      expect(detectIdentifierType('johndoe')).toBe('username')
    })

    it('classifies a username with underscores as username', () => {
      expect(detectIdentifierType('john_doe')).toBe('username')
    })

    it('classifies a username with numbers as username', () => {
      expect(detectIdentifierType('user123')).toBe('username')
    })

    it('classifies an empty string as username', () => {
      expect(detectIdentifierType('')).toBe('username')
    })

    it('classifies a single character as username', () => {
      expect(detectIdentifierType('a')).toBe('username')
    })

    it('classifies a string with dots but no @ as username', () => {
      expect(detectIdentifierType('john.doe')).toBe('username')
    })

    it('classifies a string with hyphens but no @ as username', () => {
      expect(detectIdentifierType('john-doe')).toBe('username')
    })
  })
})
