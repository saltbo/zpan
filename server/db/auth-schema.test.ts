import { describe, expect, it } from 'vitest'
import { user } from './auth-schema.js'

describe('auth-schema user table', () => {
  it('has a username column', () => {
    expect(user.username).toBeDefined()
  })

  it('username column maps to the "username" SQL column name', () => {
    expect(user.username.name).toBe('username')
  })

  it('username column is text type', () => {
    expect(user.username.columnType).toBe('SQLiteText')
  })

  it('username column has a unique constraint', () => {
    expect(user.username.isUnique).toBe(true)
  })

  it('username column is nullable (no notNull)', () => {
    expect(user.username.notNull).toBe(false)
  })

  it('has a displayUsername column', () => {
    expect(user.displayUsername).toBeDefined()
  })

  it('displayUsername column maps to the "display_username" SQL column name', () => {
    expect(user.displayUsername.name).toBe('display_username')
  })

  it('displayUsername column is text type', () => {
    expect(user.displayUsername.columnType).toBe('SQLiteText')
  })

  it('displayUsername column has no unique constraint', () => {
    expect(user.displayUsername.isUnique).toBeFalsy()
  })

  it('displayUsername column is nullable (no notNull)', () => {
    expect(user.displayUsername.notNull).toBe(false)
  })
})
