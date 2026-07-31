import type { AuthorizationScope } from '@shared/authorization'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { recordAuditEffect } from '../lib/audit'
import { forbidden, unauthorized } from '../usecases/ports'
import { type AuthzContext, anonymousAuthzContext, type Env, workspaceOrgId } from './platform'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  admin: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

export type TeamRole = 'viewer' | 'editor' | 'owner'
export type RequiredAuthorizationScopes = readonly [AuthorizationScope, ...AuthorizationScope[]]

export type ScopedAuthorizationPolicy = {
  scopes: RequiredAuthorizationScopes
  minTeamRole?: TeamRole
  siteRole?: 'admin'
  auditDenied?: boolean
}

export type RouteAuthorizationDeclaration = { public: true } | ScopedAuthorizationPolicy

export type AuthzDenialReason =
  | 'missing_credential'
  | 'actor_not_allowed'
  | 'missing_scope'
  | 'workspace_required'
  | 'insufficient_role'
  | 'insufficient_site_role'

export type AuthzDecision =
  | { allowed: true; effectiveOrgId: string | null; reason: 'allowed' }
  | { allowed: false; status: 401 | 403; reason: AuthzDenialReason; audit: boolean }

type AuthzDeps = {
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  findPersonalOrg(userId: string): Promise<string | null>
}

type SessionWithPlugins = {
  user: { id: string; role?: string }
}

export async function evaluateAuthorization(input: {
  context: AuthzContext
  declaration: RouteAuthorizationDeclaration
  deps: AuthzDeps
}): Promise<AuthzDecision> {
  const { context, declaration, deps } = input
  if ('public' in declaration) return allow(workspaceOrgId(context))
  return evaluateScopedPolicy(context, declaration, deps)
}

async function evaluateScopedPolicy(
  context: AuthzContext,
  policy: ScopedAuthorizationPolicy,
  deps: AuthzDeps,
): Promise<AuthzDecision> {
  if (context.credential === 'anonymous') return deny(context, 401, 'missing_credential', policy)

  if (context.credential !== 'session') {
    for (const scope of policy.scopes) {
      if (!context.grantedScopes.has(scope)) return deny(context, 403, 'missing_scope', policy)
    }
  }

  if (context.credential === 'session' && policy.siteRole === 'admin' && context.state.role !== 'admin') {
    return deny(context, 403, 'insufficient_site_role', policy)
  }

  return evaluateRole(context, policy.minTeamRole, policy, deps)
}

async function evaluateRole(
  context: AuthzContext,
  minTeamRole: TeamRole | undefined,
  declaration: RouteAuthorizationDeclaration,
  deps: AuthzDeps,
): Promise<AuthzDecision> {
  if (!minTeamRole) return allow(workspaceOrgId(context))
  const userId = context.userId
  if (!userId) return deny(context, 401, 'actor_not_allowed', declaration)
  const orgId = workspaceOrgId(context)
  if (!orgId) return deny(context, 401, 'workspace_required', declaration)

  const role = await deps.getMemberRole(orgId, userId)
  if (role !== null) {
    return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS[minTeamRole]
      ? allow(orgId)
      : deny(context, 403, 'insufficient_role', declaration)
  }

  const personalOrgId = await deps.findPersonalOrg(userId)
  return personalOrgId === orgId ? allow(orgId) : deny(context, 403, 'insufficient_role', declaration)
}

export function authorize(declaration: RouteAuthorizationDeclaration) {
  return createMiddleware<Env>(async (c, next) => {
    if ('public' in declaration) {
      await next()
      return
    }
    const context = await currentAuthorizationContext(c, declaration)
    const decision = await evaluateAuthorization({
      context,
      declaration,
      deps: {
        getMemberRole: (orgId, userId) => c.get('deps').org.getMemberRole(orgId, userId),
        findPersonalOrg: (userId) => c.get('deps').org.findPersonalOrg(userId),
      },
    })
    if (decision.allowed) {
      if (decision.effectiveOrgId) c.set('orgId', decision.effectiveOrgId)
      await next()
      return
    }
    if (decision.audit) {
      await recordAuditEffect('authorization_denied', () => recordDenialAudit(c, decision.reason))
    }
    if (decision.status === 401) throw unauthorized('Unauthorized')
    throw forbidden('Forbidden')
  })
}

async function currentAuthorizationContext(
  c: Context<Env>,
  declaration: RouteAuthorizationDeclaration,
): Promise<AuthzContext> {
  const context = c.get('authzContext')
  if (context.credential !== 'session' || isSafeMethod(c.req.method) || !containsSiteAdmin(declaration)) {
    return context
  }

  const freshSession = (await c.get('auth').api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  })) as SessionWithPlugins | null
  if (!freshSession?.user?.id) return anonymousAuthzContext()
  return {
    ...context,
    userId: freshSession.user.id,
    actor: { type: 'user', ref: freshSession.user.id },
    state: { firstParty: true, role: freshSession.user.role },
  }
}

function containsSiteAdmin(declaration: RouteAuthorizationDeclaration): boolean {
  if ('public' in declaration) return false
  return declaration.siteRole === 'admin'
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

function allow(effectiveOrgId: string | null): AuthzDecision {
  return { allowed: true, effectiveOrgId, reason: 'allowed' }
}

function deny(
  context: AuthzContext,
  status: 401 | 403,
  reason: AuthzDenialReason,
  declaration: RouteAuthorizationDeclaration,
): AuthzDecision {
  return {
    allowed: false,
    status,
    reason,
    audit: status === 403 && context.credential !== 'anonymous' && shouldAudit(declaration),
  }
}

function shouldAudit(declaration: RouteAuthorizationDeclaration): boolean {
  if ('public' in declaration) return false
  return declaration.auditDenied !== false
}

async function recordDenialAudit(c: Context<Env>, reason: AuthzDenialReason) {
  const context = c.get('authzContext')
  if (!context.actor) return
  const orgId = workspaceOrgId(context) ?? c.get('orgId')
  if (!orgId) return
  await c.get('deps').audit.record({
    orgId,
    userId: context.userId,
    actorType: context.actor.type,
    actorRef: context.actor.ref,
    actorIssuer: 'issuer' in context.actor ? context.actor.issuer : null,
    action: 'authorization_denied',
    targetType: 'route',
    targetName: 'scoped route',
    metadata: {
      method: c.req.method.toUpperCase(),
      credential: context.credential,
      reason,
    },
  })
}
