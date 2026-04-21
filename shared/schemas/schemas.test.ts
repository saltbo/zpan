import { describe, expect, it } from 'vitest'
import {
  copyMatterSchema,
  createMatterSchema,
  createStorageSchema,
  signInSchema,
  signUpSchema,
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
    const result = createMatterSchema.safeParse({ name: 'file.txt', type: 'text/plain' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.parent).toBe('')
      expect(result.data.dirtype).toBe(0)
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
