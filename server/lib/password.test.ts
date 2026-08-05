import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing boundary', () => {
  it('round-trips the correct password and rejects a different password', () => {
    const hash = hashPassword('correct horse battery staple')

    expect(verifyPassword(hash, 'correct horse battery staple')).toBe(true)
    expect(verifyPassword(hash, 'wrong password')).toBe(false)
  })

  it('uses a fresh salt for every hash', () => {
    expect(hashPassword('same password')).not.toBe(hashPassword('same password'))
  })

  it('rejects malformed hashes without throwing', () => {
    expect(verifyPassword('not-a-password-hash', 'password')).toBe(false)
  })
})
