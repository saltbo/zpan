import { createMiddleware } from 'hono/factory'
import type { Env } from './platform'

export const accessLog = createMiddleware<Env>(async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  const { method } = c.req
  const path = c.req.path
  const status = c.res.status
  const userId = c.get('userId') ?? '-'
  console.log(`${method} ${path} ${status} ${ms}ms uid=${userId}`)
})
