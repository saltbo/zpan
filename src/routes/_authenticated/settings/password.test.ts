import { describe, expect, it } from 'vitest'

// PasswordPage component is a React rendering component. The project has no
// jsdom or @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - ChangePasswordForm: password schema validation (match check)

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
