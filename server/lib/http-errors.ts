import {
  type CanonicalStatus,
  canonicalStatusForHttp,
  ERROR_DOMAIN,
  ERROR_INFO_TYPE,
  ErrorReason,
  type ErrorResponse,
} from '@shared/schemas'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  AppError,
  BackgroundJobError,
  DownloadError,
  NameConflictError,
  ObjectUploadSessionError,
  StorageQuotaExceededError,
  WebDavPathError,
} from '../usecases/ports'

// Per-error overrides for the AIP-193 body. `reason` defaults to the canonical
// `status`; `status` defaults to the HTTP-status mapping; `domain` to zpan.dev.
export interface ErrorOptions {
  reason?: string
  status?: CanonicalStatus
  metadata?: Record<string, string>
  domain?: string
}

// The single place that builds an AIP-193 (`google.rpc.Status`) error body. Every
// error the API surfaces — `AppError` values and mapped domain errors, all rendered
// by `jsonError` — flows through here, so the wire shape is defined exactly once.
export function buildErrorBody(httpStatus: number, message: string, opts: ErrorOptions = {}): ErrorResponse {
  const status = opts.status ?? canonicalStatusForHttp(httpStatus)
  const reason = opts.reason ?? status
  return {
    error: {
      code: httpStatus,
      message,
      status,
      details: [
        {
          '@type': ERROR_INFO_TYPE,
          reason,
          domain: opts.domain ?? ERROR_DOMAIN,
          ...(opts.metadata ? { metadata: opts.metadata } : {}),
        },
      ],
    },
  }
}

export interface DomainErrorMapping {
  status: ContentfulStatusCode
  /** Plain message for text responses (e.g. WebDAV). */
  message: string
  /** AIP-193 body for JSON responses. */
  json: ErrorResponse
}

const mapping = (status: ContentfulStatusCode, message: string, opts?: ErrorOptions): DomainErrorMapping => ({
  status,
  message,
  json: buildErrorBody(status, message, opts),
})

// Translate a domain error a usecase threw into its HTTP status + AIP-193 body.
// Wired into the global `app.onError`, so handlers `throw` instead of hand-rolling
// per-route try/catch. Returns null for errors we don't translate; `onError` then
// falls back to a generic 500. To support a new domain error: add a branch here.
export function mapDomainError(error: unknown): DomainErrorMapping | null {
  if (error instanceof AppError) {
    return mapping(error.httpStatus as ContentfulStatusCode, error.message, {
      reason: error.meta.reason,
      status: error.meta.canonicalStatus,
      metadata: error.meta.metadata,
    })
  }
  if (error instanceof StorageQuotaExceededError) {
    return mapping(422, 'Quota exceeded', { reason: ErrorReason.QUOTA_EXCEEDED, status: 'RESOURCE_EXHAUSTED' })
  }
  if (error instanceof NameConflictError) {
    const metadata: Record<string, string> = { conflictingName: error.conflictingName }
    if (error.conflictingId) metadata.conflictingId = error.conflictingId
    return mapping(409, error.message, { reason: ErrorReason.NAME_CONFLICT, status: 'ALREADY_EXISTS', metadata })
  }
  if (error instanceof ObjectUploadSessionError) {
    if (error.code === 'storage_failure') {
      return mapping(502, error.message, { reason: 'STORAGE_FAILURE' })
    }
    if (error.code === 'not_found') {
      return mapping(404, 'Not found')
    }
    return mapping(409, 'Invalid upload session state', { reason: 'INVALID_STATE' })
  }
  if (error instanceof WebDavPathError) {
    return mapping(error.status as ContentfulStatusCode, error.message)
  }
  if (error instanceof DownloadError) {
    const reason = error.code.toUpperCase()
    if (error.code === 'not_found') return mapping(404, 'Not found', { reason })
    if (error.code === 'forbidden') return mapping(403, 'Forbidden', { reason })
    return mapping(409, error.message, { reason })
  }
  if (error instanceof BackgroundJobError) {
    if (error.code === 'not_cancelable') {
      return mapping(409, 'Background job cannot be canceled', { reason: 'NOT_CANCELABLE' })
    }
    if (error.code === 'not_retryable') {
      return mapping(409, 'Background job cannot be retried', { reason: 'NOT_RETRYABLE' })
    }
    return mapping(404, 'Not found')
  }
  return null
}
