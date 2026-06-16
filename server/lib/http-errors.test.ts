import { describe, expect, it } from 'vitest'
import { NameConflictError, StorageQuotaExceededError, WebDavPathError } from '../usecases/ports'
import { mapDomainError } from './http-errors'

describe('mapDomainError', () => {
  it('maps StorageQuotaExceededError to 422', () => {
    const m = mapDomainError(new StorageQuotaExceededError())
    expect(m?.status).toBe(422)
    expect(m?.message).toBe('Quota exceeded')
    expect(m?.json.error.code).toBe(422)
    expect(m?.json.error.message).toBe('Quota exceeded')
    expect(m?.json.error.status).toBe('RESOURCE_EXHAUSTED')
    expect(m?.json.error.details?.[0]?.reason).toBe('QUOTA_EXCEEDED')
  })

  it('maps NameConflictError to 409 with conflict metadata', () => {
    const m = mapDomainError(new NameConflictError('doc.txt', 'id-1'))
    expect(m?.status).toBe(409)
    expect(m?.json.error.code).toBe(409)
    expect(m?.json.error.status).toBe('ALREADY_EXISTS')
    expect(m?.json.error.details?.[0]?.reason).toBe('NAME_CONFLICT')
    expect(m?.json.error.details?.[0]?.metadata).toMatchObject({ conflictingName: 'doc.txt', conflictingId: 'id-1' })
  })

  it('maps WebDavPathError to its own status', () => {
    const m = mapDomainError(new WebDavPathError('Bad path', 409))
    expect(m?.status).toBe(409)
    expect(m?.message).toBe('Bad path')
    expect(m?.json.error.code).toBe(409)
    expect(m?.json.error.message).toBe('Bad path')
    expect(m?.json.error.status).toBe('ABORTED')
    expect(m?.json.error.details?.[0]?.reason).toBe('ABORTED')
  })

  it('returns null for unrecognized errors', () => {
    expect(mapDomainError(new Error('boom'))).toBeNull()
    expect(mapDomainError(null)).toBeNull()
  })
})
