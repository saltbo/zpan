import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { recordAuditEffect } from '../lib/audit'
import { formatError } from '../lib/errors'
import { auditActor } from './audit-actor'
import { type AuditRoute, matchAuditRoute, resolveAuditRouteEvent } from './audit-registry'
import { AUDIT_ROUTES } from './audit-routes'
import type { Env } from './platform'

export const auditMiddleware = createMiddleware<Env>(async (c, next) => {
  const matched = matchAuditRoute(AUDIT_ROUTES, c.req.method, new URL(c.req.url).pathname)
  const prepared = matched?.route.options.prepare ? await prepareAuditRoute(c, matched.route) : undefined

  await next()

  if (!matched) return
  await recordAuditEffect(`${matched.route.method} ${matched.route.path}`, async () => {
    const event = await resolveAuditRouteEvent(c, matched, prepared)
    if (event) await c.get('deps').audit.record({ ...auditActor(c.get('principal')), ...event })
  })
})

async function prepareAuditRoute(c: Context<Env>, route: AuditRoute): Promise<unknown> {
  try {
    const params = route.match(new URL(c.req.url).pathname)
    return params ? await route.options.prepare?.({ c, params }) : undefined
  } catch (error) {
    console.error(`audit.prepare_failed route=${route.method}:${route.path} code=${formatError(error)}`)
    return undefined
  }
}
