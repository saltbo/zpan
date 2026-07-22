import type { Context } from 'hono'
import type { RecordAuditEventInput } from '../usecases/ports'
import type { Env } from './platform'

type MaybePromise<T> = T | Promise<T>

export type AuditValue<T> = T | ((context: AuditRouteContext) => MaybePromise<T>)

export type AuditTarget = {
  type: AuditValue<string>
  id?: AuditValue<string | null | undefined>
  name?: AuditValue<string | null | undefined>
}

export type AuditRouteOptions = {
  orgId?: AuditValue<string | null | undefined>
  statuses?: readonly number[] | ((status: number) => boolean)
  prepare?: (context: AuditPrepareContext) => MaybePromise<unknown>
  resolve?: (context: AuditRouteContext) => MaybePromise<unknown>
  when?: (context: AuditRouteContext) => MaybePromise<boolean>
  metadata?:
    | Record<string, AuditValue<unknown>>
    | ((context: AuditRouteContext) => MaybePromise<Record<string, unknown> | undefined>)
}

export type AuditRoute = {
  method: string
  path: string
  action: AuditValue<string | null>
  target: AuditTarget
  options: AuditRouteOptions
  match(pathname: string): Record<string, string> | null
}

export type MatchedAuditRoute = {
  route: AuditRoute
  params: Record<string, string>
}

export type AuditPrepareContext = {
  c: Context<Env>
  params: Record<string, string>
}

export class AuditRouteContext {
  readonly c: Context<Env>
  readonly params: Record<string, string>
  resource: unknown
  private requestPromise?: Promise<Record<string, unknown>>
  private responsePromise?: Promise<Record<string, unknown>>

  constructor(c: Context<Env>, params: Record<string, string>, resource: unknown) {
    this.c = c
    this.params = params
    this.resource = resource
  }

  request(): Promise<Record<string, unknown>> {
    this.requestPromise ??= this.c.req.json<Record<string, unknown>>()
    return this.requestPromise
  }

  response(): Promise<Record<string, unknown>> {
    this.responsePromise ??= this.c.res.clone().json() as Promise<Record<string, unknown>>
    return this.responsePromise
  }

  async requestValue(path: string): Promise<unknown> {
    return readPath(await this.request(), path)
  }

  async responseValue(path: string): Promise<unknown> {
    return readPath(await this.response(), path)
  }

  preparedValue(path: string): unknown {
    return readPath(this.resource, path)
  }
}

export function auditRoute(
  method: string,
  path: string,
  action: AuditValue<string | null>,
  target: AuditTarget,
  options: AuditRouteOptions = {},
): AuditRoute {
  const match = compilePath(path)
  return { method, path, action, target, options, match }
}

export function defineAuditRoutes(...groups: ReadonlyArray<ReadonlyArray<AuditRoute>>): AuditRoute[] {
  const routes = groups.flat()
  const keys = new Set<string>()
  for (const route of routes) {
    const key = `${route.method}:${route.path}`
    if (keys.has(key)) throw new Error(`duplicate_audit_route:${key}`)
    keys.add(key)
  }
  return routes
}

export function matchAuditRoute(
  routes: readonly AuditRoute[],
  method: string,
  pathname: string,
): MatchedAuditRoute | null {
  for (const route of routes) {
    if (route.method !== method) continue
    const params = route.match(pathname)
    if (params) return { route, params }
  }
  return null
}

export async function resolveAuditRouteEvent(
  c: Context<Env>,
  matched: MatchedAuditRoute,
  prepared: unknown,
): Promise<Omit<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef'> | null> {
  const { route, params } = matched
  if (!matchesStatus(route.options.statuses, c.res.status)) return null

  const context = new AuditRouteContext(c, params, prepared)
  if (route.options.resolve) context.resource = await route.options.resolve(context)
  if (route.options.when && !(await route.options.when(context))) return null

  const action = await resolveValue(route.action, context)
  if (!action) return null
  const targetType = await resolveValue(route.target.type, context)
  const targetId = route.target.id ? await resolveValue(route.target.id, context) : undefined
  const targetName = route.target.name ? await resolveValue(route.target.name, context) : undefined
  const orgId = route.options.orgId ? await resolveValue(route.options.orgId, context) : c.get('orgId')
  if (!orgId) throw new Error(`audit_org_context_missing:${action}`)

  return {
    orgId,
    action,
    targetType,
    targetId: targetId ?? undefined,
    targetName: targetName ?? targetId ?? targetType,
    metadata: await resolveMetadata(route.options.metadata, context),
  }
}

export function param(name: string): AuditValue<string | undefined> {
  return ({ params }) => params[name]
}

export function requestValue(path: string): AuditValue<unknown> {
  return (context: AuditRouteContext) => context.requestValue(path)
}

export function responseValue(path: string): AuditValue<unknown> {
  return (context: AuditRouteContext) => context.responseValue(path)
}

export function preparedValue(path: string): AuditValue<unknown> {
  return (context: AuditRouteContext) => context.preparedValue(path)
}

export function stringValue(value: AuditValue<unknown>): AuditValue<string | undefined> {
  return async (context) => {
    const resolved = await resolveValue(value, context)
    return typeof resolved === 'string' ? resolved : undefined
  }
}

export function firstValue<T>(...values: Array<AuditValue<T | null | undefined>>): AuditValue<T | undefined> {
  return async (context) => {
    for (const value of values) {
      const resolved = await resolveValue(value, context)
      if (resolved !== null && resolved !== undefined) return resolved
    }
    return undefined
  }
}

export function preparedExists(context: AuditRouteContext): boolean {
  return context.resource !== null && context.resource !== undefined
}

async function resolveValue<T>(value: AuditValue<T>, context: AuditRouteContext): Promise<T> {
  return typeof value === 'function' ? await (value as (context: AuditRouteContext) => MaybePromise<T>)(context) : value
}

async function resolveMetadata(
  metadata: AuditRouteOptions['metadata'],
  context: AuditRouteContext,
): Promise<Record<string, unknown> | undefined> {
  if (!metadata) return undefined
  if (typeof metadata === 'function') return metadata(context)

  const entries = await Promise.all(
    Object.entries(metadata).map(async ([key, value]) => [key, await resolveValue(value, context)] as const),
  )
  const resolved = Object.fromEntries(entries.filter(([, value]) => value !== undefined))
  return Object.keys(resolved).length > 0 ? resolved : undefined
}

function matchesStatus(statuses: AuditRouteOptions['statuses'], status: number): boolean {
  if (!statuses) return status >= 200 && status < 400
  return typeof statuses === 'function' ? statuses(status) : statuses.includes(status)
}

function compilePath(template: string): (pathname: string) => Record<string, string> | null {
  const names: string[] = []
  const parts = template
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (!part.startsWith(':')) return escapeRegExp(part)
      names.push(part.slice(1))
      return '([^/]+)'
    })
  const pattern = new RegExp(`^/${parts.join('/')}/?$`)

  return (pathname) => {
    const match = pathname.match(pattern)
    if (!match) return null
    return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
