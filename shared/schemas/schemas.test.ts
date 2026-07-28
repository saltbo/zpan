import { describe, expect, it } from 'vitest'
import {
  copyMatterSchema,
  createDownloadTaskSchema,
  createMatterSchema,
  createStorageSchema,
  signInSchema,
  signUpSchema,
  updateImageDomainSettingsSchema,
  updateMatterSchema,
} from './index.js'

describe('signInSchema', () => {
  it('accepts valid input', () => {
    const result = signInSchema.safeParse({ email: 'a@b.com', password: '123456' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = signInSchema.safeParse({ email: 'bad', password: '123456' })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = signInSchema.safeParse({ email: 'a@b.com', password: '12345' })
    expect(result.success).toBe(false)
  })
})

describe('signUpSchema', () => {
  it('accepts valid input', () => {
    const result = signUpSchema.safeParse({ email: 'a@b.com', username: 'testuser', password: '123456' })
    expect(result.success).toBe(true)
  })

  it('rejects short username', () => {
    const result = signUpSchema.safeParse({ email: 'a@b.com', username: 'ab', password: '123456' })
    expect(result.success).toBe(false)
  })

  it('rejects missing username', () => {
    const result = signUpSchema.safeParse({ email: 'a@b.com', password: '123456' })
    expect(result.success).toBe(false)
  })
})

describe('createStorageSchema', () => {
  const valid = {
    bucket: 'my-bucket',
    endpoint: 'https://s3.amazonaws.com',
    accessKey: 'AK',
    secretKey: 'SK',
  }

  it('accepts valid input with defaults', () => {
    const result = createStorageSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.region).toBe('auto')
    }
  })

  it('rejects invalid endpoint URL', () => {
    const result = createStorageSchema.safeParse({ ...valid, endpoint: 'not-a-url' })
    expect(result.success).toBe(false)
  })
})

describe('createMatterSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = createMatterSchema.safeParse({ name: 'file.txt', type: 'text/plain' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.parent).toBe('')
      expect(result.data.dirtype).toBe(0)
    }
  })

  it('accepts a missing optional content type', () => {
    const result = createMatterSchema.safeParse({ name: 'unknown.bin' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBeUndefined()
  })

  it('accepts an optional target storage id', () => {
    const result = createMatterSchema.safeParse({ name: 'file.txt', type: 'text/plain', storageId: 'st-1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.storageId).toBe('st-1')
    }
  })

  it('rejects empty name', () => {
    const result = createMatterSchema.safeParse({ name: '', type: 'text/plain' })
    expect(result.success).toBe(false)
  })
})

describe('updateMatterSchema', () => {
  it('accepts partial update with name only', () => {
    const result = updateMatterSchema.safeParse({ name: 'renamed.txt' })
    expect(result.success).toBe(true)
  })

  it('accepts empty object (no fields)', () => {
    const result = updateMatterSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = updateMatterSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })
})

describe('copyMatterSchema', () => {
  it('requires copyFrom field', () => {
    const result = copyMatterSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts copyFrom with default parent', () => {
    const result = copyMatterSchema.safeParse({ copyFrom: 'source-id' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.parent).toBe('')
      expect(result.data.copyFrom).toBe('source-id')
    }
  })

  it('accepts copyFrom with explicit parent', () => {
    const result = copyMatterSchema.safeParse({ copyFrom: 'source-id', parent: 'folder-id' })
    expect(result.success).toBe(true)
  })
})

describe('createDownloadTaskSchema', () => {
  it('normalizes target folder paths', () => {
    const result = createDownloadTaskSchema.safeParse({
      source: { type: 'http', uri: 'https://example.com/file.zip' },
      targetFolder: '/media//Movies\\2026/',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.targetFolder).toBe('media/Movies/2026')
    }
  })

  it('rejects parent directory target folder segments', () => {
    const result = createDownloadTaskSchema.safeParse({
      source: { type: 'http', uri: 'https://example.com/file.zip' },
      targetFolder: 'media/../private',
    })

    expect(result.success).toBe(false)
  })
})

describe('updateImageDomainSettingsSchema', () => {
  it('accepts complete Cloudflare automation settings', () => {
    const result = updateImageDomainSettingsSchema.safeParse({
      enabled: true,
      provider: 'cloudflare_saas',
      cloudflare: {
        apiToken: 'token',
        zoneId: '0123456789abcdef0123456789abcdef',
        routingMode: 'worker',
        workerName: 'zpan',
        cnameTarget: 'images.example.com',
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a Cloudflare external origin without a Worker name', () => {
    const result = updateImageDomainSettingsSchema.safeParse({
      enabled: true,
      provider: 'cloudflare_saas',
      cloudflare: {
        apiToken: 'token',
        zoneId: '0123456789abcdef0123456789abcdef',
        routingMode: 'origin',
        originHostname: 'origin.example.com',
        cnameTarget: 'images.example.com',
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts CNAME, IPv4, and IPv6 records', () => {
    const result = updateImageDomainSettingsSchema.safeParse({
      enabled: true,
      provider: 'manual',
      manual: {
        records: [
          { type: 'CNAME', value: 'images.example.com' },
          { type: 'A', value: '192.0.2.10' },
          { type: 'AAAA', value: '2001:db8::10' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['CNAME', 'https://images.example.com'],
    ['A', '999.0.2.10'],
    ['AAAA', 'not-an-ip'],
  ])('rejects an invalid %s record', (type, value) => {
    const result = updateImageDomainSettingsSchema.safeParse({
      enabled: true,
      provider: 'manual',
      manual: { records: [{ type, value }] },
    })
    expect(result.success).toBe(false)
  })

  it('requires a real Cloudflare zone id', () => {
    const result = updateImageDomainSettingsSchema.safeParse({
      enabled: true,
      provider: 'cloudflare_saas',
      cloudflare: {
        apiToken: 'token',
        zoneId: 'zone-1',
        routingMode: 'worker',
        workerName: 'zpan',
        cnameTarget: 'ssl.example.com',
      },
    })
    expect(result.success).toBe(false)
  })
})
