import { describe, expect, it } from 'vitest'
import { createMatterSchema, createStorageSchema, signInSchema, signUpSchema } from './index.js'

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
    const result = signUpSchema.safeParse({ name: 'Test', email: 'a@b.com', password: '123456' })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = signUpSchema.safeParse({ name: '', email: 'a@b.com', password: '123456' })
    expect(result.success).toBe(false)
  })
})

describe('createStorageSchema', () => {
  const valid = {
    title: 'My S3',
    mode: 'private' as const,
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
      expect(result.data.filePath).toBe('$UID/$RAW_NAME')
    }
  })

  it('rejects invalid mode', () => {
    const result = createStorageSchema.safeParse({ ...valid, mode: 'shared' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid endpoint URL', () => {
    const result = createStorageSchema.safeParse({ ...valid, endpoint: 'not-a-url' })
    expect(result.success).toBe(false)
  })
})

describe('createMatterSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = createMatterSchema.safeParse({ name: 'file.txt', type: 'text/plain', storageId: 's1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.parent).toBe('')
      expect(result.data.dirtype).toBe(0)
    }
  })

  it('rejects empty name', () => {
    const result = createMatterSchema.safeParse({ name: '', type: 'text/plain', storageId: 's1' })
    expect(result.success).toBe(false)
  })
})
