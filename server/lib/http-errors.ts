import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { NameConflictError } from '../services/matter-name-conflict'
import { WebDavPathError } from '../services/webdav-path'
import { StorageQuotaExceededError } from '../usecases/ports'

export interface DomainErrorMapping {
  status: ContentfulStatusCode
  /** Plain message for text responses (e.g. WebDAV). */
  message: string
  /** Structured body for JSON responses. */
  json: Record<string, unknown>
}

/**
 * Maps a known domain error to its HTTP status and response bodies, or null
 * when the error is not one we translate (caller should rethrow). Centralizes
 * the quota→422 / name-conflict→409 / webdav-path mappings that routes
 * otherwise hand-roll.
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
  if (error instanceof WebDavPathError) {
    return { status: error.status as ContentfulStatusCode, message: error.message, json: { error: error.message } }
  }
  return null
}
