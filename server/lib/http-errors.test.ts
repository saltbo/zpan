import { describe, expect, it } from 'vitest'
import { NameConflictError } from '../services/matter-name-conflict'
import { StorageQuotaExceededError } from '../services/storage-usage'
import { WebDavPathError } from '../services/webdav-path'
import { mapDomainError } from './http-errors'

describe('mapDomainError', () => {
  it('maps StorageQuotaExceededError to 422', () => {
    const m = mapDomainError(new StorageQuotaExceededError())
    expect(m).toEqual({ status: 422, message: 'Quota exceeded', json: { error: 'Quota exceeded' } })
  })

  it('maps NameConflictError to 409 with conflict metadata', () => {
    const m = mapDomainError(new NameConflictError('doc.txt', 'id-1'))
    expect(m?.status).toBe(409)
    expect(m?.json).toMatchObject({ code: 'NAME_CONFLICT', conflictingName: 'doc.txt', conflictingId: 'id-1' })
  })

  it('maps WebDavPathError to its own status', () => {
    const m = mapDomainError(new WebDavPathError('Bad path', 409))
    expect(m).toEqual({ status: 409, message: 'Bad path', json: { error: 'Bad path' } })
  })

  it('returns null for unrecognized errors', () => {
    expect(mapDomainError(new Error('boom'))).toBeNull()
    expect(mapDomainError(null)).toBeNull()
  })
})
