import type { Context } from 'hono'
import { formatError } from '../lib/errors'
import { ApiError, buildErrorBody, mapDomainError } from '../lib/http-errors'
import type { Env } from './platform'

// Turn any thrown error into the AIP-193 response we return to the client, and
// stash its reason + message on the context for the access log. Shared by the
// accessLog boundary (which catches /api throws so it can log the real mapped
// status) and `app.onError` (the backstop for errors thrown outside that
// boundary, e.g. earlier middleware or non-access-logged routes).
//
// The client never sees an internal stack: an untranslated error becomes a
// generic 500 body, while the full `cause` chain goes only to `errorLog` →
// the access log. Domain errors and `ApiError` carry their own safe message.
export function renderError(c: Context<Env>, err: unknown): Response {
  if (err instanceof ApiError) {
    const body = err.toBody()
    c.set('errorLog', { reason: body.error.details?.[0]?.reason ?? body.error.status, message: err.message })
    return c.json(body, err.httpStatus)
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

// True when `renderError` would translate `err` into a specific (non-500) result.
// Lets `app.onError` log only genuinely unhandled errors as `http.unhandled_error`.
export function isHandledError(err: unknown): boolean {
  return err instanceof ApiError || mapDomainError(err) !== null
}
