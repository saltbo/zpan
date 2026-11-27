import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { formLevelError, serverFieldError, setServerFieldError } from '@/lib/form-errors'

function validationError(message: string, field?: string) {
  return new ApiError(400, {
    error: {
      code: 400,
      message,
      status: 'INVALID_ARGUMENT',
      details: [{ reason: 'INVALID_ARGUMENT', domain: 'zpan.dev', metadata: field ? { field } : {} }],
    },
  })
}

const fields = {
  'cloudflare.zoneId': 'zoneId',
  'manual.records': 'records',
  manual: 'manual',
} as const

describe('serverFieldError', () => {
  it('maps the field the server names to the form field', () => {
    expect(serverFieldError(validationError('Bad zone', 'cloudflare.zoneId'), fields)).toEqual({
      field: 'zoneId',
      message: 'Bad zone',
    })
  })

  it('maps a path below a key to that key, preferring the longest match', () => {
    expect(
      serverFieldError(validationError('CNAME value must be a hostname', 'manual.records.0.value'), fields),
    ).toEqual({ field: 'records', message: 'CNAME value must be a hostname' })
  })

  it('does not match a key that only shares a prefix', () => {
    expect(serverFieldError(validationError('Bad', 'cloudflare.zoneIdentifier'), fields)).toBeUndefined()
  })

  it('returns undefined for an unknown field, no field, or an error that is not from the API', () => {
    expect(serverFieldError(validationError('Bad', 'cloudflare.apiToken'), fields)).toBeUndefined()
    expect(serverFieldError(validationError('Bad'), fields)).toBeUndefined()
    expect(serverFieldError(new Error('Network down'), fields)).toBeUndefined()
    expect(serverFieldError(null, fields)).toBeUndefined()
  })
})

describe('formLevelError', () => {
  it('keeps an error without a known field at form level', () => {
    expect(formLevelError(validationError('Invalid request'), fields)).toBe('Invalid request')
    expect(formLevelError(validationError('Bad', 'cloudflare.apiToken'), fields)).toBe('Bad')
    expect(formLevelError(new Error('Network down'), fields)).toBe('Network down')
  })

  it('leaves a field error and no error out of the form-level message', () => {
    expect(formLevelError(validationError('Bad zone', 'cloudflare.zoneId'), fields)).toBeNull()
    expect(formLevelError(null, fields)).toBeNull()
  })
})

describe('setServerFieldError', () => {
  it('sets a server error on the mapped react-hook-form field', () => {
    const setError = vi.fn()
    expect(setServerFieldError(setError, validationError('Bad zone', 'cloudflare.zoneId'), fields)).toBe(true)
    expect(setError).toHaveBeenCalledWith('zoneId', { type: 'server', message: 'Bad zone' })
  })

  it('leaves the form alone when the error names no known field', () => {
    const setError = vi.fn()
    expect(setServerFieldError(setError, new Error('Network down'), fields)).toBe(false)
    expect(setError).not.toHaveBeenCalled()
  })
})
