import { describe, expect, it } from 'vitest'
import { formatError } from './errors'

describe('formatError', () => {
  it('returns the message for a plain error', () => {
    expect(formatError(new Error('boom'))).toBe('boom')
  })

  it('flattens the cause chain (drizzle wraps the real D1 error in cause)', () => {
    const d1 = new Error('D1_ERROR: Network connection lost')
    const wrapped = new Error('Failed query: update "download_tasks" ...', { cause: d1 })
    expect(formatError(wrapped)).toBe('Failed query: update "download_tasks" ... <- D1_ERROR: Network connection lost')
  })

  it('appends a non-Error cause', () => {
    const err = new Error('outer', { cause: 'inner string' })
    expect(formatError(err)).toBe('outer <- inner string')
  })

  it('stringifies a non-Error value', () => {
    expect(formatError('plain string')).toBe('plain string')
  })
})
