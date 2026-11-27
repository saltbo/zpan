import type { ErrorResponse } from '@shared/schemas'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { formatError } from '../lib/errors'
import { buildErrorBody, mapDomainError } from '../lib/http-errors'
import { AppError, type ErrorLanguage, localizeMessage, textMessage } from '../usecases/ports'
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
//
// The response `message` is in the request's language (`Accept-Language`, which the
// SPA sets from its own language setting); the access log keeps the English text.
export function jsonError(c: Context<Env>, err: unknown): Response {
  const language = requestLanguage(c.req.raw)
  if (err instanceof AppError) {
    const body = buildErrorBody(err.httpStatus, err.localizedMessage(language), {
      reason: err.meta.reason,
      status: err.meta.canonicalStatus,
      metadata: err.meta.metadata,
    })
    c.set('errorLog', {
      reason: body.error.details?.[0]?.reason ?? body.error.status,
      message: err.meta.diagnostics?.message ?? err.message,
      diagnostic: err.meta.diagnostics?.reason,
    })
    return c.json(body, err.httpStatus as ContentfulStatusCode, err.meta.headers)
  }

  const mapped = mapDomainError(err)
  if (mapped) {
    c.set('errorLog', {
      reason: mapped.json.error.details?.[0]?.reason ?? mapped.json.error.status,
      message: mapped.diagnostic ?? mapped.message,
    })
    return c.json(localizeBody(mapped.json, language), mapped.status)
  }

  const detail = formatError(err)
  c.set('errorLog', { reason: 'INTERNAL', message: detail })
  return c.json(internalErrorBody(language), 500)
}

// Render the same JSON error outside Hono's request pipeline. Cloudflare's
// image-domain fast path runs before the full app (and Better Auth) exists.
export function standaloneJsonError(err: unknown, request?: Request): Response {
  const language = request ? requestLanguage(request) : 'en'
  if (err instanceof AppError) {
    return Response.json(
      buildErrorBody(err.httpStatus, err.localizedMessage(language), {
        reason: err.meta.reason,
        status: err.meta.canonicalStatus,
        metadata: err.meta.metadata,
      }),
      { status: err.httpStatus, headers: err.meta.headers },
    )
  }

  const mapped = mapDomainError(err)
  if (mapped) return Response.json(localizeBody(mapped.json, language), { status: mapped.status })

  return Response.json(internalErrorBody(language), { status: 500 })
}

// The supported language the request prefers most, by `Accept-Language` q-value.
// English when the header names neither English nor Chinese.
export function requestLanguage(request: Request): ErrorLanguage {
  const header = request.headers.get('Accept-Language')
  if (!header) return 'en'
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...attrs] = part.trim().toLowerCase().split(';')
      const q = attrs.map((attr) => attr.trim()).find((attr) => attr.startsWith('q='))
      return { tag, q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter(({ q }) => q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { tag } of ranked) {
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return 'en'
}

function localizeBody(body: ErrorResponse, language: ErrorLanguage): ErrorResponse {
  return { error: { ...body.error, message: localizeMessage(textMessage(body.error.message), language) } }
}

function internalErrorBody(language: ErrorLanguage): ErrorResponse {
  return buildErrorBody(500, localizeMessage('Internal Server Error', language), { reason: 'INTERNAL' })
}

// True when `jsonError` would translate `err` into a specific (non-500) result.
// Lets `app.onError` log only genuinely unhandled errors as `http.unhandled_error`.
export function isHandledError(err: unknown): boolean {
  return err instanceof AppError || mapDomainError(err) !== null
}
