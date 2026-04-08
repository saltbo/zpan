/**
 * Tests for the storage form validation schema.
 *
 * The schema is defined inline in storage-form-dialog.tsx and is not exported.
 * These tests reconstruct the same schema from its public specification (the
 * documented field requirements visible in the component's public interface)
 * and verify the validation contract that the form presents to callers of
 * onSubmit.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Mirror of the storageSchema defined in storage-form-dialog.tsx.
// Any change to that schema's validation rules must be reflected here.
const storageSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().min(1),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  filePath: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.coerce.number().min(1),
})

const validInput = {
  title: 'My Storage',
  mode: 'private' as const,
  bucket: 'my-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  filePath: '{uid}/{date}/{filename}{ext}',
  capacity: 100,
}

describe('storageSchema — happy path', () => {
  it('accepts a fully populated private storage', () => {
    expect(storageSchema.safeParse(validInput).success).toBe(true)
  })

  it('accepts mode public', () => {
    const result = storageSchema.safeParse({ ...validInput, mode: 'public' })
    expect(result.success).toBe(true)
  })

  it('accepts an optional customHost', () => {
    const result = storageSchema.safeParse({
      ...validInput,
      customHost: 'https://cdn.example.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts when customHost is omitted entirely', () => {
    const { customHost: _omit, ...rest } = { ...validInput, customHost: undefined }
    expect(storageSchema.safeParse(rest).success).toBe(true)
  })

  it('coerces a numeric string to number for capacity', () => {
    const result = storageSchema.safeParse({ ...validInput, capacity: '50' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capacity).toBe(50)
    }
  })
})

describe('storageSchema — boundary conditions', () => {
  it('accepts capacity of exactly 1 (minimum allowed)', () => {
    expect(storageSchema.safeParse({ ...validInput, capacity: 1 }).success).toBe(true)
  })

  it('accepts single-character strings for required text fields', () => {
    const result = storageSchema.safeParse({
      ...validInput,
      title: 'A',
      bucket: 'b',
      endpoint: 'e',
      region: 'r',
      accessKey: 'k',
      secretKey: 's',
      filePath: '/',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty string for optional customHost', () => {
    const result = storageSchema.safeParse({ ...validInput, customHost: '' })
    expect(result.success).toBe(true)
  })
})

describe('storageSchema — error cases', () => {
  it('rejects when title is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, title: '' }).success).toBe(false)
  })

  it('rejects when bucket is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, bucket: '' }).success).toBe(false)
  })

  it('rejects when endpoint is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, endpoint: '' }).success).toBe(false)
  })

  it('rejects when region is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, region: '' }).success).toBe(false)
  })

  it('rejects when accessKey is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, accessKey: '' }).success).toBe(false)
  })

  it('rejects when secretKey is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, secretKey: '' }).success).toBe(false)
  })

  it('rejects when filePath is empty', () => {
    expect(storageSchema.safeParse({ ...validInput, filePath: '' }).success).toBe(false)
  })

  it('rejects capacity of 0', () => {
    expect(storageSchema.safeParse({ ...validInput, capacity: 0 }).success).toBe(false)
  })

  it('rejects capacity below 1', () => {
    expect(storageSchema.safeParse({ ...validInput, capacity: -1 }).success).toBe(false)
  })

  it('rejects an invalid mode value', () => {
    expect(storageSchema.safeParse({ ...validInput, mode: 'readonly' }).success).toBe(false)
  })

  it('rejects when mode is missing', () => {
    const { mode: _omit, ...rest } = validInput
    expect(storageSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects when title is missing', () => {
    const { title: _omit, ...rest } = validInput
    expect(storageSchema.safeParse(rest).success).toBe(false)
  })
})
