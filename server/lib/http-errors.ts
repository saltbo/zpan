import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  BackgroundJobError,
  DownloadError,
  NameConflictError,
  ObjectUploadSessionError,
  StorageQuotaExceededError,
  WebDavPathError,
} from '../usecases/ports'

export interface DomainErrorMapping {
  status: ContentfulStatusCode
  /** Plain message for text responses (e.g. WebDAV). */
  message: string
  /** Structured body for JSON responses. */
  json: Record<string, unknown>
}

/**
 * The single place that translates a domain error into its HTTP status and
 * response body. Every error a usecase throws and the API surfaces flows through
 * here — wired into the global `app.onError`, so handlers `throw` instead of
 * hand-rolling per-route try/catch. Returns null for errors we don't translate;
 * `onError` then falls back to a generic 500.
 *
 * To support a new domain error: add a branch here, nowhere else.
 */
export function mapDomainError(error: unknown): DomainErrorMapping | null {
  if (error instanceof StorageQuotaExceededError) {
    return { status: 422, message: 'Quota exceeded', json: { error: 'Quota exceeded' } }
  }
  if (error instanceof NameConflictError) {
    return {
      status: 409,
      message: error.message,
      json: {
        error: error.message,
        code: 'NAME_CONFLICT',
        conflictingName: error.conflictingName,
        conflictingId: error.conflictingId,
      },
    }
  }
  if (error instanceof ObjectUploadSessionError) {
    if (error.code === 'storage_failure') {
      return { status: 502, message: error.message, json: { error: error.message } }
    }
    if (error.code === 'not_found') {
      return { status: 404, message: 'Not found', json: { error: 'Not found' } }
    }
    return { status: 409, message: 'Invalid upload session state', json: { error: 'Invalid upload session state' } }
  }
  if (error instanceof WebDavPathError) {
    return { status: error.status as ContentfulStatusCode, message: error.message, json: { error: error.message } }
  }
  if (error instanceof DownloadError) {
    if (error.code === 'not_found') return { status: 404, message: 'Not found', json: { error: 'Not found' } }
    if (error.code === 'forbidden') return { status: 403, message: 'Forbidden', json: { error: 'Forbidden' } }
    return { status: 409, message: error.message, json: { error: error.message } }
  }
  if (error instanceof BackgroundJobError) {
    if (error.code === 'not_cancelable') {
      const m = 'Background job cannot be canceled'
      return { status: 409, message: m, json: { error: m } }
    }
    if (error.code === 'not_retryable') {
      const m = 'Background job cannot be retried'
      return { status: 409, message: m, json: { error: m } }
    }
    return { status: 404, message: 'Not found', json: { error: 'Not found' } }
  }
  return null
}
