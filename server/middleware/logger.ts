import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Env } from './platform'

export const accessLog = createMiddleware<Env>(async (c, next) => {
  const start = Date.now()
  try {
    await next()
  } catch (error) {
    writeAccessLog(c, start, 500, error)
    throw error
  }
  writeAccessLog(c, start, c.res.status)
})

function writeAccessLog(c: Context<Env>, start: number, status: number, error?: unknown) {
  const fields = accessLogFields(c, start, status, error)
  console.log(fields.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' '))
}

function accessLogFields(
  c: Context<Env>,
  start: number,
  status: number,
  error?: unknown,
): Array<[string, string | number]> {
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
      ['contentLength', c.req.header('Content-Length') ?? '-'],
      ['contentRange', c.res.headers.get('Content-Range') ?? '-'],
      ['userAgent', c.req.header('User-Agent') ?? '-'],
    )
  }

  if (error instanceof Error) {
    fields.push(['error', error.message])
  } else if (error) {
    fields.push(['error', String(error)])
  }

  return fields
}
