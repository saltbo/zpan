export const EMAIL_VERIFICATION_REQUIRED_OPTION_KEY = 'auth_require_email_verification'

export function isEmailVerificationRequired(value: string | null): boolean {
  return value === 'true'
}
