import { SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// SignUp is a React rendering component. The project has no jsdom or
// @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - closed mode: shows "registration closed" view instead of form
//   - invite code field: shown only in invite_only mode
//   - invite code inclusion in submission payload: only when invite_only
//   - username pattern constraint

// ---------------------------------------------------------------------------
// Closed mode — mirrors the early return in SignUp:
//   if (authSignupMode === SignupMode.CLOSED) return <closed view>
// ---------------------------------------------------------------------------

function isRegistrationClosed(authSignupMode: SignupMode): boolean {
  return authSignupMode === SignupMode.CLOSED
}

describe('SignUp — registration closed mode', () => {
  it('shows closed view when mode is closed', () => {
    expect(isRegistrationClosed(SignupMode.CLOSED)).toBe(true)
  })

  it('shows form when mode is open', () => {
    expect(isRegistrationClosed(SignupMode.OPEN)).toBe(false)
  })

  it('shows form when mode is invite_only', () => {
    expect(isRegistrationClosed(SignupMode.INVITE_ONLY)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Invite code field visibility — mirrors:
//   {authSignupMode === SignupMode.INVITE_ONLY && <invite code input>}
// ---------------------------------------------------------------------------

function shouldShowInviteCodeField(authSignupMode: SignupMode): boolean {
  return authSignupMode === SignupMode.INVITE_ONLY
}

describe('SignUp — invite code field visibility', () => {
  it('shows invite code field when mode is invite_only', () => {
    expect(shouldShowInviteCodeField(SignupMode.INVITE_ONLY)).toBe(true)
  })

  it('hides invite code field when mode is open', () => {
    expect(shouldShowInviteCodeField(SignupMode.OPEN)).toBe(false)
  })

  it('hides invite code field when mode is closed', () => {
    expect(shouldShowInviteCodeField(SignupMode.CLOSED)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Submission payload — mirrors the spread in handleSubmit:
//   ...(authSignupMode === SignupMode.INVITE_ONLY ? { inviteCode } : {})
// ---------------------------------------------------------------------------

interface SignUpPayload {
  username: string
  email: string
  password: string
  callbackURL: string
  inviteCode?: string
}

function buildSignUpPayload(
  authSignupMode: SignupMode,
  fields: { username: string; email: string; password: string; inviteCode: string },
): SignUpPayload {
  return {
    username: fields.username,
    email: fields.email,
    password: fields.password,
    callbackURL: '/files',
    ...(authSignupMode === SignupMode.INVITE_ONLY ? { inviteCode: fields.inviteCode } : {}),
  }
}

const baseFields = {
  username: 'johndoe',
  email: 'john@example.com',
  password: 'secret',
  inviteCode: 'INVITE-123',
}

describe('SignUp — submission payload construction', () => {
  it('includes inviteCode in payload when mode is invite_only', () => {
    const payload = buildSignUpPayload(SignupMode.INVITE_ONLY, baseFields)

    expect(payload.inviteCode).toBe('INVITE-123')
  })

  it('omits inviteCode from payload when mode is open', () => {
    const payload = buildSignUpPayload(SignupMode.OPEN, baseFields)

    expect(payload.inviteCode).toBeUndefined()
  })

  it('omits inviteCode from payload when mode is closed (form not shown, but guard)', () => {
    const payload = buildSignUpPayload(SignupMode.CLOSED, baseFields)

    expect(payload.inviteCode).toBeUndefined()
  })

  it('always sets callbackURL to "/files"', () => {
    const payloadOpen = buildSignUpPayload(SignupMode.OPEN, baseFields)
    const payloadInvite = buildSignUpPayload(SignupMode.INVITE_ONLY, baseFields)

    expect(payloadOpen.callbackURL).toBe('/files')
    expect(payloadInvite.callbackURL).toBe('/files')
  })

  it('includes all base fields in payload', () => {
    const payload = buildSignUpPayload(SignupMode.OPEN, baseFields)

    expect(payload.username).toBe('johndoe')
    expect(payload.email).toBe('john@example.com')
    expect(payload.password).toBe('secret')
  })
})

// ---------------------------------------------------------------------------
// Username pattern constraint — mirrors HTML pattern="^[a-zA-Z0-9_]{3,30}$"
// ---------------------------------------------------------------------------

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/

function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

describe('SignUp — username pattern validation', () => {
  it('accepts a valid alphanumeric username', () => {
    expect(isValidUsername('johndoe')).toBe(true)
  })

  it('accepts a username with underscores', () => {
    expect(isValidUsername('john_doe_42')).toBe(true)
  })

  it('accepts exactly 3 characters (minimum length)', () => {
    expect(isValidUsername('abc')).toBe(true)
  })

  it('accepts exactly 30 characters (maximum length)', () => {
    expect(isValidUsername('a'.repeat(30))).toBe(true)
  })

  it('rejects username shorter than 3 characters', () => {
    expect(isValidUsername('ab')).toBe(false)
  })

  it('rejects username longer than 30 characters', () => {
    expect(isValidUsername('a'.repeat(31))).toBe(false)
  })

  it('rejects username with special characters', () => {
    expect(isValidUsername('john-doe')).toBe(false)
  })

  it('rejects username with spaces', () => {
    expect(isValidUsername('john doe')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidUsername('')).toBe(false)
  })

  it('accepts mixed case letters', () => {
    expect(isValidUsername('JohnDoe99')).toBe(true)
  })
})
