import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  downloaderBootstrapCredential,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthPushedAuthorizationRequest,
  oauthRefreshToken,
  user,
} from './auth-schema.js'

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

describe('OAuth tables', () => {
  it('declares the managed client columns and indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(oauthClient)

    expect(oauthClient.clientId.name).toBe('client_id')
    expect(oauthClient.redirectUris.notNull).toBe(true)
    expect(oauthClient.requirePKCE.name).toBe('require_pkce')
    expect(oauthClient.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date)
    expect(foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)).toEqual(['id'])
    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'oauthClient_client_id_idx',
      'oauthClient_user_id_idx',
    ])
  })

  it('declares refresh-token relationships and lookup indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(oauthRefreshToken)

    expect(oauthRefreshToken.referenceId.name).toBe('reference_id')
    expect(oauthRefreshToken.revoked.name).toBe('revoked')
    expect(foreignKeys).toHaveLength(3)
    expect(foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)).toEqual([
      'client_id',
      'id',
      'id',
    ])
    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'oauthRefreshToken_client_id_idx',
      'oauthRefreshToken_session_id_idx',
      'oauthRefreshToken_token_idx',
      'oauthRefreshToken_user_id_idx',
    ])
  })

  it('declares access-token relationships and lookup indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(oauthAccessToken)

    expect(oauthAccessToken.referenceId.name).toBe('reference_id')
    expect(oauthAccessToken.expiresAt.notNull).toBe(true)
    expect(foreignKeys).toHaveLength(4)
    expect(foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)).toEqual([
      'client_id',
      'id',
      'id',
      'id',
    ])
    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'oauthAccessToken_client_id_idx',
      'oauthAccessToken_refresh_id_idx',
      'oauthAccessToken_session_id_idx',
      'oauthAccessToken_token_idx',
      'oauthAccessToken_user_id_idx',
    ])
  })

  it('declares consent relationships and lookup indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(oauthConsent)

    expect(oauthConsent.referenceId.name).toBe('reference_id')
    expect(oauthConsent.scopes.notNull).toBe(true)
    expect(oauthConsent.lastUsedAt.name).toBe('last_used_at')
    expect(oauthConsent.lastUsedAt.notNull).toBe(false)
    expect(foreignKeys).toHaveLength(2)
    expect(oauthConsent.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date)
    expect(foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)).toEqual(['client_id', 'id'])
    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'oauthConsent_client_id_idx',
      'oauthConsent_user_id_idx',
    ])
  })

  it('declares pushed authorization request relationships and lookup indexes', () => {
    const { foreignKeys, indexes } = getTableConfig(oauthPushedAuthorizationRequest)

    expect(oauthPushedAuthorizationRequest.requestUri.isUnique).toBe(true)
    expect(oauthPushedAuthorizationRequest.parameters.notNull).toBe(true)
    expect(foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)).toEqual(['client_id'])
    expect(indexes.map((index) => index.config.name).sort()).toEqual([
      'oauthPushedAuthorizationRequest_client_id_idx',
      'oauthPushedAuthorizationRequest_expires_at_idx',
    ])
  })
})
