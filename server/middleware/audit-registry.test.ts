import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { RecordAuditEventInput } from '../usecases/ports'
import {
  auditRoute,
  defineAuditRoutes,
  matchAuditRoute,
  param,
  requestValue,
  resolveAuditRouteEvent,
  responseValue,
  stringValue,
} from './audit-registry'
import type { Env } from './platform'

describe('audit route registry', () => {
  it('maps a method and route template to a normalized resource event', async () => {
    const route = auditRoute(
      'PATCH',
      '/api/widgets/:widgetId',
      'widget_update',
      {
        type: 'widget',
        id: param('widgetId'),
        name: stringValue(responseValue('name')),
      },
      { metadata: { label: stringValue(requestValue('label')) } },
    )
    const event = await requestEvent(route, '/api/widgets/widget%201', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'new label' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(event).toEqual({
      orgId: 'org-1',
      action: 'widget_update',
      targetType: 'widget',
      targetId: 'widget 1',
      targetName: 'Widget One',
      metadata: { label: 'new label' },
    })
  })

  it('uses the standard success range unless a route declares failure statuses', async () => {
    const standard = auditRoute('DELETE', '/api/widgets/:widgetId', 'widget_delete', {
      type: 'widget',
      id: param('widgetId'),
    })
    const failure = auditRoute(
      'GET',
      '/api/widgets/:widgetId',
      'widget_read_failed',
      {
        type: 'widget',
        id: param('widgetId'),
      },
      { statuses: [404] },
    )

    await expect(requestEvent(standard, '/api/widgets/missing', { method: 'DELETE' }, 404)).resolves.toBeNull()
    await expect(requestEvent(failure, '/api/widgets/missing', undefined, 404)).resolves.toMatchObject({
      action: 'widget_read_failed',
      targetId: 'missing',
    })
  })

  it('rejects duplicate registrations at startup', () => {
    const first = auditRoute('POST', '/api/widgets', 'widget_create', { type: 'widget' })
    const duplicate = auditRoute('POST', '/api/widgets', 'widget_import', { type: 'widget' })

    expect(() => defineAuditRoutes([first], [duplicate])).toThrow('duplicate_audit_route:POST:/api/widgets')
  })
})

async function requestEvent(
  route: ReturnType<typeof auditRoute>,
  path: string,
  init?: RequestInit,
  status = 200,
): Promise<Omit<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef'> | null> {
  let event: Omit<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef'> | null = null
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-1')
    await next()
    const matched = matchAuditRoute([route], c.req.method, new URL(c.req.url).pathname)
    if (matched) event = await resolveAuditRouteEvent(c, matched, undefined)
  })
  app.all('*', (c) => c.json({ id: 'widget 1', name: 'Widget One' }, status as 200))

  await app.request(path, init)
  return event
}
