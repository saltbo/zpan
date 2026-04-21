import { describe, expect, it } from 'vitest'
import { apikey } from './auth-schema.js'
import { imageHostingConfigs, imageHostings } from './schema.js'

describe('imageHostingConfigs table', () => {
  it('uses org_id as primary key', () => {
    expect(imageHostingConfigs.orgId.name).toBe('org_id')
    expect(imageHostingConfigs.orgId.primary).toBe(true)
  })

  it('has a nullable custom_domain column', () => {
    expect(imageHostingConfigs.customDomain).toBeDefined()
    expect(imageHostingConfigs.customDomain.name).toBe('custom_domain')
    expect(imageHostingConfigs.customDomain.notNull).toBe(false)
  })

  it('custom_domain has a unique constraint', () => {
    expect(imageHostingConfigs.customDomain.isUnique).toBe(true)
  })

  it('has nullable cf_hostname_id column', () => {
    expect(imageHostingConfigs.cfHostnameId).toBeDefined()
    expect(imageHostingConfigs.cfHostnameId.name).toBe('cf_hostname_id')
    expect(imageHostingConfigs.cfHostnameId.notNull).toBe(false)
  })

  it('has nullable domain_verified_at column (timestamp_ms)', () => {
    expect(imageHostingConfigs.domainVerifiedAt).toBeDefined()
    expect(imageHostingConfigs.domainVerifiedAt.name).toBe('domain_verified_at')
    expect(imageHostingConfigs.domainVerifiedAt.columnType).toBe('SQLiteTimestamp')
    expect(imageHostingConfigs.domainVerifiedAt.notNull).toBe(false)
  })

  it('has nullable referer_allowlist column', () => {
    expect(imageHostingConfigs.refererAllowlist).toBeDefined()
    expect(imageHostingConfigs.refererAllowlist.notNull).toBe(false)
  })

  it('has not-null created_at and updated_at timestamps', () => {
    expect(imageHostingConfigs.createdAt.notNull).toBe(true)
    expect(imageHostingConfigs.updatedAt.notNull).toBe(true)
  })
})

describe('imageHostings table', () => {
  it('has a text primary key id', () => {
    expect(imageHostings.id.name).toBe('id')
    expect(imageHostings.id.primary).toBe(true)
    expect(imageHostings.id.columnType).toBe('SQLiteText')
  })

  it('has not-null org_id column', () => {
    expect(imageHostings.orgId.name).toBe('org_id')
    expect(imageHostings.orgId.notNull).toBe(true)
  })

  it('has unique token column', () => {
    expect(imageHostings.token.name).toBe('token')
    expect(imageHostings.token.notNull).toBe(true)
    expect(imageHostings.token.isUnique).toBe(true)
  })

  it('has not-null path column', () => {
    expect(imageHostings.path.name).toBe('path')
    expect(imageHostings.path.notNull).toBe(true)
  })

  it('has not-null storage_id and storage_key columns', () => {
    expect(imageHostings.storageId.notNull).toBe(true)
    expect(imageHostings.storageKey.notNull).toBe(true)
  })

  it('has not-null size and mime columns', () => {
    expect(imageHostings.size.notNull).toBe(true)
    expect(imageHostings.mime.notNull).toBe(true)
  })

  it('has nullable width and height columns', () => {
    expect(imageHostings.width.notNull).toBe(false)
    expect(imageHostings.height.notNull).toBe(false)
  })

  it('status defaults to "draft"', () => {
    expect(imageHostings.status.notNull).toBe(true)
    expect(imageHostings.status.default).toBe('draft')
  })

  it('access_count defaults to 0', () => {
    expect(imageHostings.accessCount.notNull).toBe(true)
    expect(imageHostings.accessCount.default).toBe(0)
  })

  it('has nullable last_accessed_at timestamp', () => {
    expect(imageHostings.lastAccessedAt.notNull).toBe(false)
  })

  it('has not-null created_at timestamp', () => {
    expect(imageHostings.createdAt.notNull).toBe(true)
  })
})

describe('apikey table', () => {
  it('has a text primary key id', () => {
    expect(apikey.id.name).toBe('id')
    expect(apikey.id.primary).toBe(true)
  })

  it('config_id defaults to "default"', () => {
    expect(apikey.configId.name).toBe('config_id')
    expect(apikey.configId.notNull).toBe(true)
    expect(apikey.configId.default).toBe('default')
  })

  it('has not-null reference_id for org/user scoping', () => {
    expect(apikey.referenceId.name).toBe('reference_id')
    expect(apikey.referenceId.notNull).toBe(true)
  })

  it('has not-null key column', () => {
    expect(apikey.key.name).toBe('key')
    expect(apikey.key.notNull).toBe(true)
  })

  it('enabled defaults to true', () => {
    expect(apikey.enabled.notNull).toBe(true)
    expect(apikey.enabled.default).toBe(true)
  })

  it('rate_limit_enabled defaults to true', () => {
    expect(apikey.rateLimitEnabled.notNull).toBe(true)
    expect(apikey.rateLimitEnabled.default).toBe(true)
  })

  it('request_count defaults to 0', () => {
    expect(apikey.requestCount.notNull).toBe(true)
    expect(apikey.requestCount.default).toBe(0)
  })

  it('has not-null created_at and updated_at', () => {
    expect(apikey.createdAt.notNull).toBe(true)
    expect(apikey.updatedAt.notNull).toBe(true)
  })

  it('has nullable permissions column for JSON-serialized statements', () => {
    expect(apikey.permissions).toBeDefined()
    expect(apikey.permissions.notNull).toBe(false)
  })
})
