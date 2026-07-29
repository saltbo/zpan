import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { downloaderBootstrapCredential, user } from './auth-schema.js'

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

describe('downloaderBootstrapCredential table', () => {
  it('stores the bootstrap token hash as a unique text column', () => {
    expect(downloaderBootstrapCredential.tokenHash.name).toBe('token_hash')
    expect(downloaderBootstrapCredential.tokenHash.columnType).toBe('SQLiteText')
    expect(downloaderBootstrapCredential.tokenHash.notNull).toBe(true)
    expect(downloaderBootstrapCredential.tokenHash.isUnique).toBe(true)
  })

  it('stores required downloader bootstrap metadata', () => {
    expect(downloaderBootstrapCredential.userId.name).toBe('user_id')
    expect(downloaderBootstrapCredential.userId.notNull).toBe(true)
    expect(downloaderBootstrapCredential.deviceCode.name).toBe('device_code')
    expect(downloaderBootstrapCredential.deviceCode.notNull).toBe(true)
    expect(downloaderBootstrapCredential.clientId.name).toBe('client_id')
    expect(downloaderBootstrapCredential.clientId.notNull).toBe(true)
    expect(downloaderBootstrapCredential.scope.name).toBe('scope')
    expect(downloaderBootstrapCredential.scope.notNull).toBe(true)
  })

  it('tracks expiry, optional consumption, and creation timestamps', () => {
    expect(downloaderBootstrapCredential.expiresAt.name).toBe('expires_at')
    expect(downloaderBootstrapCredential.expiresAt.columnType).toBe('SQLiteTimestamp')
    expect(downloaderBootstrapCredential.expiresAt.notNull).toBe(true)
    expect(downloaderBootstrapCredential.consumedAt.name).toBe('consumed_at')
    expect(downloaderBootstrapCredential.consumedAt.columnType).toBe('SQLiteTimestamp')
    expect(downloaderBootstrapCredential.consumedAt.notNull).toBe(false)
    expect(downloaderBootstrapCredential.createdAt.name).toBe('created_at')
    expect(downloaderBootstrapCredential.createdAt.notNull).toBe(true)
  })

  it('declares the bootstrap lookup indexes and user foreign key', () => {
    const { foreignKeys, indexes } = getTableConfig(downloaderBootstrapCredential)

    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'downloader_bootstrap_consumed_idx',
      'downloader_bootstrap_token_hash_idx',
      'downloader_bootstrap_user_idx',
    ])
    expect(foreignKeys).toHaveLength(1)
    expect(foreignKeys[0].reference().foreignColumns[0].name).toBe('id')
  })
})
