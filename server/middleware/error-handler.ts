import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { formatError } from '../lib/errors'
import { buildErrorBody, mapDomainError } from '../lib/http-errors'
import { AppError } from '../usecases/ports'
import type { Env } from './platform'

// Render a business error as its AIP-193 JSON response, and stash reason + message
// on the context for the access log. THE one place errors become responses: usecases
// return `AppError` values, handlers `throw result.error`, and the accessLog boundary
// + `app.onError` pass every thrown error through here.
//
// An `AppError` carries its own status/reason/message/headers (built once by the
// factories in usecases/ports/app-error). Legacy domain errors are still translated
// by `mapDomainError`. Anything else is an unexpected failure: the client gets a
// generic 500 while the full `cause` chain goes only to `errorLog` → the access log.
export function jsonError(c: Context<Env>, err: unknown): Response {
  if (err instanceof AppError) {
    const body = buildErrorBody(err.httpStatus, err.message, {
      reason: err.meta.reason,
      status: err.meta.canonicalStatus,
      metadata: err.meta.metadata,
    })
    c.set('errorLog', { reason: body.error.details?.[0]?.reason ?? body.error.status, message: err.message })
    return c.json(body, err.httpStatus as ContentfulStatusCode, err.meta.headers)
  }

  const mapped = mapDomainError(err)
  if (mapped) {
    c.set('errorLog', {
      reason: mapped.json.error.details?.[0]?.reason ?? mapped.json.error.status,
      message: mapped.message,
    })
    return c.json(mapped.json, mapped.status)
  }

  const detail = formatError(err)
  c.set('errorLog', { reason: 'INTERNAL', message: detail })
  return c.json(buildErrorBody(500, 'Internal Server Error', { reason: 'INTERNAL' }), 500)
}

// True when `jsonError` would translate `err` into a specific (non-500) result.
// Lets `app.onError` log only genuinely unhandled errors as `http.unhandled_error`.
export function isHandledError(err: unknown): boolean {
  return err instanceof AppError || mapDomainError(err) !== null
}
