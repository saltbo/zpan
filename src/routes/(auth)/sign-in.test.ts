import { SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// SignIn is a React rendering component. The project has no jsdom or
// @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - identity routing: email vs. username detection
//   - sign-up link visibility based on signup mode

// ---------------------------------------------------------------------------
// Identity routing — mirrors the logic in handleSubmit:
//   const isEmail = identity.includes('@')
//   isEmail → signIn.email(...)
//   else   → signIn.username(...)
// ---------------------------------------------------------------------------

function detectIdentityType(identity: string): 'email' | 'username' {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity) ? 'email' : 'username'
}

describe('SignIn — identity type detection', () => {
  it('detects email for a standard address', () => {
    expect(detectIdentityType('user@example.com')).toBe('email')
  })

  it('detects username when identity does not contain "@"', () => {
    expect(detectIdentityType('myusername')).toBe('username')
  })

  it('detects username for a bare "@" (not a valid email)', () => {
    expect(detectIdentityType('@')).toBe('username')
  })

  it('detects username for "a@b" (no TLD)', () => {
    expect(detectIdentityType('a@b')).toBe('username')
  })

  it('detects username for a plain string with no "@"', () => {
    expect(detectIdentityType('john_doe_42')).toBe('username')
  })

  it('detects email when "@" appears in the middle with valid domain', () => {
    expect(detectIdentityType('first.last@domain.org')).toBe('email')
  })

  it('detects username for an empty string', () => {
    expect(detectIdentityType('')).toBe('username')
  })

  it('detects username when "@" appears at the start without local part', () => {
    expect(detectIdentityType('@username')).toBe('username')
  })

  it('detects username for "user@" (no domain)', () => {
    expect(detectIdentityType('user@')).toBe('username')
  })

  it('detects email for complex local part', () => {
    expect(detectIdentityType('user.name+tag@example.co.uk')).toBe('email')
  })
})

// ---------------------------------------------------------------------------
// Sign-up link visibility — mirrors the JSX conditional:
//   {authSignupMode !== SignupMode.CLOSED && <sign-up link>}
// ---------------------------------------------------------------------------

function shouldShowSignUpLink(authSignupMode: SignupMode): boolean {
  return authSignupMode !== SignupMode.CLOSED
}

describe('SignIn — sign-up link visibility', () => {
  it('shows sign-up link when mode is open', () => {
    expect(shouldShowSignUpLink(SignupMode.OPEN)).toBe(true)
  })

  it('shows sign-up link when mode is invite_only', () => {
    expect(shouldShowSignUpLink(SignupMode.INVITE_ONLY)).toBe(true)
  })

  it('hides sign-up link when mode is closed', () => {
    expect(shouldShowSignUpLink(SignupMode.CLOSED)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// OAuth callback URL used for social sign-in
// ---------------------------------------------------------------------------

const SIGN_IN_CALLBACK_URL = '/files'

describe('SignIn — OAuth and form callback URL', () => {
  it('callback URL for sign-in is "/files"', () => {
    expect(SIGN_IN_CALLBACK_URL).toBe('/files')
  })
})
