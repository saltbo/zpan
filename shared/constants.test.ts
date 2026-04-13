import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus, SignupMode, StorageMode, UserRole } from './constants.js'

describe('constants', () => {
  it('StorageMode values', () => {
    expect(StorageMode.PRIVATE).toBe('private')
    expect(StorageMode.PUBLIC).toBe('public')
  })

  it('UserRole values', () => {
    expect(UserRole.ADMIN).toBe('admin')
    expect(UserRole.MEMBER).toBe('member')
  })

  it('DirType values', () => {
    expect(DirType.FILE).toBe(0)
    expect(DirType.USER_FOLDER).toBe(1)
    expect(DirType.SYSTEM_FOLDER).toBe(2)
  })

  it('ObjectStatus values', () => {
    expect(ObjectStatus.DRAFT).toBe('draft')
    expect(ObjectStatus.ACTIVE).toBe('active')
    expect(ObjectStatus.TRASHED).toBe('trashed')
  })

  it('SignupMode.OPEN equals "open"', () => {
    expect(SignupMode.OPEN).toBe('open')
  })

  it('SignupMode.INVITE_ONLY equals "invite_only"', () => {
    expect(SignupMode.INVITE_ONLY).toBe('invite_only')
  })

  it('SignupMode.CLOSED equals "closed"', () => {
    expect(SignupMode.CLOSED).toBe('closed')
  })

  it('SignupMode has exactly three members', () => {
    expect(Object.keys(SignupMode)).toHaveLength(3)
  })
})
