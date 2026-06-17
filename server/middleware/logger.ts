import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Env } from './platform'

// The request boundary for /api and /dav: one structured line per request, logged
// after the response is finalized. By the time `next()` returns, the status and
// `errorLog` are settled — every error is an `AppError` (or domain error) thrown by
// the handler and rendered by `app.onError` via `jsonError`, which sets `errorLog`
// before control returns here. So the log records the REAL mapped status (a thrown
// 409 logs as 409, not 500) and carries the error's reason + full message for every
// 4xx/5xx, not just unhandled crashes.
export const accessLog = createMiddleware<Env>(async (c, next) => {
  const start = Date.now()
  await next()
  writeAccessLog(c, start)
})

function writeAccessLog(c: Context<Env>, start: number) {
  const fields = accessLogFields(c, start)
  console.log(fields.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' '))
}

function accessLogFields(c: Context<Env>, start: number): Array<[string, string | number]> {
  const status = c.res.status
  const fields: Array<[string, string | number]> = [
    ['method', c.req.method],
    ['path', c.req.path],
    ['status', status],
    ['ms', Date.now() - start],
    ['uid', c.get('userId') ?? '-'],
  ]

  if (c.req.path.startsWith('/dav/')) {
    fields.push(
      ['range', c.req.header('Range') ?? '-'],
      ['ifRange', c.req.header('If-Range') ?? '-'],
      ['ifNoneMatch', c.req.header('If-None-Match') ?? '-'],
      ['ifModifiedSince', c.req.header('If-Modified-Since') ?? '-'],
      ['contentLength', c.req.header('Content-Length') ?? '-'],
      ['contentRange', c.res.headers.get('Content-Range') ?? '-'],
      ['userAgent', c.req.header('User-Agent') ?? '-'],
    )
  }

  // Every failed request carries its reason + full message — set by jsonError when
  // it renders the thrown error (incl. the full cause chain for unhandled 500s,
  // which never reaches the client body).
  const errorLog = c.get('errorLog')
  if (errorLog) {
    fields.push(['reason', errorLog.reason], ['error', errorLog.message])
  } else if (status >= 400) {
    fields.push(['error', c.res.statusText || '-'])
  }

  return fields
}
