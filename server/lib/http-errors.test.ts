import { describe, expect, it } from 'vitest'
import {
  BackgroundJobError,
  DownloadError,
  NameConflictError,
  ObjectUploadSessionError,
  StorageQuotaExceededError,
  WebDavPathError,
} from '../usecases/ports'
import { ApiError, buildErrorBody, mapDomainError } from './http-errors'

describe('buildErrorBody', () => {
  it('defaults reason and canonical status from the HTTP code', () => {
    const body = buildErrorBody(404, 'Not found')
    expect(body).toEqual({
      error: {
        code: 404,
        message: 'Not found',
        status: 'NOT_FOUND',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'NOT_FOUND', domain: 'zpan.dev' }],
      },
    })
  })

  it('falls back to INTERNAL for unmapped 5xx and UNKNOWN for unmapped 4xx', () => {
    expect(buildErrorBody(599, 'x').error.status).toBe('INTERNAL')
    expect(buildErrorBody(418, 'x').error.status).toBe('UNKNOWN')
  })

  it('honors explicit reason, canonical status, metadata, and domain overrides', () => {
    const body = buildErrorBody(422, 'Quota exceeded', {
      reason: 'QUOTA_EXCEEDED',
      status: 'RESOURCE_EXHAUSTED',
      metadata: { resource: 'storage_egress' },
      domain: 'custom.example',
    })
    expect(body.error.status).toBe('RESOURCE_EXHAUSTED')
    expect(body.error.details?.[0]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'QUOTA_EXCEEDED',
      domain: 'custom.example',
      metadata: { resource: 'storage_egress' },
    })
  })

  it('omits metadata when none is given', () => {
    expect(buildErrorBody(403, 'Forbidden').error.details?.[0]?.metadata).toBeUndefined()
  })
})

describe('ApiError', () => {
  it('renders its AIP-193 body and preserves the message', () => {
    const err = new ApiError(402, 'Insufficient credits', {
      reason: 'INSUFFICIENT_CREDITS',
      metadata: { resource: 'storage_egress' },
    })
    expect(err.message).toBe('Insufficient credits')
    expect(err.toBody()).toEqual({
      error: {
        code: 402,
        message: 'Insufficient credits',
        status: 'FAILED_PRECONDITION',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'INSUFFICIENT_CREDITS',
            domain: 'zpan.dev',
            metadata: { resource: 'storage_egress' },
          },
        ],
      },
    })
  })
})

describe('mapDomainError', () => {
  const reasonOf = (m: ReturnType<typeof mapDomainError>) => m?.json.error.details?.[0]?.reason

  it('maps StorageQuotaExceededError to 422 / RESOURCE_EXHAUSTED', () => {
    const m = mapDomainError(new StorageQuotaExceededError())
    expect(m?.status).toBe(422)
    expect(m?.message).toBe('Quota exceeded')
    expect(m?.json.error.status).toBe('RESOURCE_EXHAUSTED')
    expect(reasonOf(m)).toBe('QUOTA_EXCEEDED')
  })

  it('maps NameConflictError to 409 / ALREADY_EXISTS with conflict metadata', () => {
    const m = mapDomainError(new NameConflictError('doc.txt', 'id-1'))
    expect(m?.status).toBe(409)
    expect(m?.json.error.status).toBe('ALREADY_EXISTS')
    expect(reasonOf(m)).toBe('NAME_CONFLICT')
    expect(m?.json.error.details?.[0]?.metadata).toEqual({ conflictingName: 'doc.txt', conflictingId: 'id-1' })
  })

  it('omits conflictingId metadata when it is empty', () => {
    const m = mapDomainError(new NameConflictError('doc.txt', ''))
    expect(m?.json.error.details?.[0]?.metadata).toEqual({ conflictingName: 'doc.txt' })
  })

  it('maps ObjectUploadSessionError by code', () => {
    expect(mapDomainError(new ObjectUploadSessionError('storage_failure', 'boom'))?.status).toBe(502)
    expect(reasonOf(mapDomainError(new ObjectUploadSessionError('storage_failure', 'boom')))).toBe('STORAGE_FAILURE')
    expect(mapDomainError(new ObjectUploadSessionError('not_found'))?.status).toBe(404)
    const invalid = mapDomainError(new ObjectUploadSessionError('invalid_state'))
    expect(invalid?.status).toBe(409)
    expect(reasonOf(invalid)).toBe('INVALID_STATE')
  })

  it('maps WebDavPathError to its own status with the canonical default reason', () => {
    const m = mapDomainError(new WebDavPathError('Bad path', 409))
    expect(m?.status).toBe(409)
    expect(m?.message).toBe('Bad path')
    expect(m?.json.error.status).toBe('ABORTED')
    expect(reasonOf(m)).toBe('ABORTED')
  })

  it('maps DownloadError by code with an UPPER_SNAKE reason', () => {
    expect(mapDomainError(new DownloadError('not_found'))?.status).toBe(404)
    expect(mapDomainError(new DownloadError('forbidden'))?.status).toBe(403)
    const other = mapDomainError(new DownloadError('invalid_state', 'Task is paused'))
    expect(other?.status).toBe(409)
    expect(other?.message).toBe('Task is paused')
    expect(reasonOf(other)).toBe('INVALID_STATE')
  })

  it('maps BackgroundJobError by code', () => {
    expect(reasonOf(mapDomainError(new BackgroundJobError('not_cancelable')))).toBe('NOT_CANCELABLE')
    expect(reasonOf(mapDomainError(new BackgroundJobError('not_retryable')))).toBe('NOT_RETRYABLE')
    expect(mapDomainError(new BackgroundJobError('not_found'))?.status).toBe(404)
  })

  it('returns null for unrecognized errors', () => {
    expect(mapDomainError(new Error('boom'))).toBeNull()
    expect(mapDomainError(null)).toBeNull()
  })
})
