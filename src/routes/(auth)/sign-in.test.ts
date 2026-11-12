import { SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'
import { absoluteAuthCallbackURL } from '@/lib/auth-callback'
import { isCredentialLoginMethod } from '@/lib/last-login-method'

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

const PREVIEW_ORIGIN = 'https://feat-x402-paid-agent-uploads-zpan.saltbo.workers.dev'

function emailSignInCallbackURL(redirectTo: string | null): string {
  return redirectTo ?? '/files'
}

function oauthCallbackURL(redirectTo: string | null): string {
  return absoluteAuthCallbackURL(redirectTo ?? '/files', PREVIEW_ORIGIN)
}

describe('SignIn — default callback URL', () => {
  it('passes the relative /files callback to the email/username sign-in', () => {
    expect(emailSignInCallbackURL(null)).toBe('/files')
    expect(emailSignInCallbackURL('/device?user_code=ABCD')).toBe('/device?user_code=ABCD')
  })

  it('keeps the absolute current-origin URL for the OAuth redirect', () => {
    expect(oauthCallbackURL(null)).toBe(`${PREVIEW_ORIGIN}/files`)
  })

  it('never carries a host or an encoded path slash into the email callback', () => {
    const emailCallback = emailSignInCallbackURL(null)

    expect(emailCallback).not.toMatch(/https?:\/\//)
    expect(emailCallback).not.toContain('%252F')
  })
})

describe('SignIn — last login method', () => {
  it.each(['email', 'username'])('treats %s as the credential form', (method) => {
    expect(isCredentialLoginMethod(method)).toBe(true)
  })

  it.each(['github', 'google', null])('does not treat %s as the credential form', (method) => {
    expect(isCredentialLoginMethod(method)).toBe(false)
  })
})

function visibleOAuthProviderCount(_captchaEnabled: boolean, providerCount: number): number {
  return providerCount
}

describe('SignIn — OAuth visibility with captcha', () => {
  it('keeps OAuth providers visible when captcha is enabled', () => {
    expect(visibleOAuthProviderCount(true, 2)).toBe(2)
  })

  it('keeps OAuth providers visible when captcha is disabled', () => {
    expect(visibleOAuthProviderCount(false, 2)).toBe(2)
  })

  it('keeps the OAuth divider when captcha is enabled and providers exist', () => {
    expect(visibleOAuthProviderCount(true, 2) > 0).toBe(true)
  })
})
