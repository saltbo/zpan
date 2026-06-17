import type { z } from '@hono/zod-openapi'
import { errorResponseSchema } from '@shared/schemas'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { buildErrorBody, type ErrorOptions } from '../lib/http-errors'
import type { Env } from '../middleware/platform'

// Shared OpenAPI route helpers used by every resource router. Generic over the
// schema so its precise type reaches `createRoute`: that types `c.req.valid(...)`
// on the request side and strictly checks the handler's `c.json(...)` on the
// response side. A widened `z.ZodType` would erase both — and silently disable
// response checking, which is how schemas drift from what handlers actually
// return.

export const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
})

// A route response carrying the shared AIP-193 `Error` envelope. Errors thrown by
// usecases are converted centrally by `app.onError`; this just documents them.
export const errorResponse = (description: string) => jsonContent(errorResponseSchema, description)

// The single way a handler returns an error inline. Builds the AIP-193 body and
// stashes the reason + message for the access log, so every 4xx/5xx is observable.
// `reason` defaults to the canonical status for the HTTP code (e.g. 403 →
// PERMISSION_DENIED); pass `opts.reason`/`opts.metadata` for specific errors.
export function apiError<S extends ContentfulStatusCode>(
  c: Context<Env>,
  status: S,
  message: string,
  opts: ErrorOptions = {},
) {
  const body = buildErrorBody(status, message, opts)
  c.set('errorLog', { reason: body.error.details?.[0]?.reason ?? body.error.status, message })
  return c.json(body, status)
}
