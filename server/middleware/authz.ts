import { type AuthorizationScope, authorizationScope } from '@shared/authorization'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { recordAuditEffect } from '../lib/audit'
import { forbidden, unauthorized } from '../usecases/ports'
import type { AuthzContext, Env } from './platform'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  admin: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

export type TeamRole = 'viewer' | 'editor' | 'owner'

export type RouteAuthorizationDeclaration =
  | { access: 'public' }
  | { access: 'internal' }
  | { access: 'admin' }
  | { access: 'session'; minTeamRole?: TeamRole }
  | { access: 'downloader' }
  | { access: 'downloader-bootstrap' }
  | { access: 'signed-webhook' }
  | { access: 'task-upload-token' }
  | { access: 'anyOf'; policies: readonly RouteAuthorizationDeclaration[] }
  | {
      access: 'protected'
      scopes?: readonly AuthorizationScope[]
      minTeamRole?: TeamRole
      allowDownloader?: boolean
      auditDenied?: boolean
    }

export type AuthzDenialReason =
  | 'missing_credential'
  | 'actor_not_allowed'
  | 'missing_scope'
  | 'workspace_required'
  | 'workspace_mismatch'
  | 'insufficient_role'

export type AuthzDecision =
  | { allowed: true; effectiveOrgId: string | null; reason: 'allowed' }
  | { allowed: false; status: 401 | 403; reason: AuthzDenialReason; audit: boolean }

type AuthzDeps = {
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  findPersonalOrg(userId: string): Promise<string | null>
}

export async function evaluateAuthorization(input: {
  context: AuthzContext
  declaration: RouteAuthorizationDeclaration
  deps: AuthzDeps
}): Promise<AuthzDecision> {
  const { context, declaration, deps } = input
  if (declaration.access === 'public') return { allowed: true, effectiveOrgId: context.orgId, reason: 'allowed' }
  if (declaration.access === 'internal') return deny(context, 403, 'actor_not_allowed', declaration)
  if (declaration.access !== 'protected') return deny(context, 403, 'actor_not_allowed', declaration)
  if (context.credential === 'anonymous') return deny(context, 401, 'missing_credential', declaration)
  if (context.credential === 'downloader') {
    return declaration.allowDownloader
      ? { allowed: true, effectiveOrgId: null, reason: 'allowed' }
      : deny(context, 401, 'actor_not_allowed', declaration)
  }
  if (context.credential === 'downloader-bootstrap') return deny(context, 401, 'actor_not_allowed', declaration)

  const requiredScopes = declaration.scopes ?? []
  if (context.grantedScopes) {
    for (const scope of requiredScopes) {
      if (!context.grantedScopes.has(scope)) return deny(context, 403, 'missing_scope', declaration)
    }
  }

  if (!declaration.minTeamRole) return { allowed: true, effectiveOrgId: context.orgId, reason: 'allowed' }
  const userId = context.userId
  if (!userId) return deny(context, 401, 'actor_not_allowed', declaration)
  const orgId = context.fixedOrgId ?? context.orgId
  if (!orgId) return deny(context, 401, 'workspace_required', declaration)
  if (context.fixedOrgId && context.orgId && context.fixedOrgId !== context.orgId) {
    return deny(context, 403, 'workspace_mismatch', declaration)
  }

  const role = await deps.getMemberRole(orgId, userId)
  if (role !== null) {
    return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS[declaration.minTeamRole]
      ? { allowed: true, effectiveOrgId: orgId, reason: 'allowed' }
      : deny(context, 403, 'insufficient_role', declaration)
  }

  const personalOrgId = await deps.findPersonalOrg(userId)
  return personalOrgId === orgId
    ? { allowed: true, effectiveOrgId: orgId, reason: 'allowed' }
    : deny(context, 403, 'insufficient_role', declaration)
}

export function authorize(declaration: RouteAuthorizationDeclaration) {
  return createMiddleware<Env>(async (c, next) => {
    const decision = await evaluateAuthorization({
      context: c.get('authzContext'),
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
      await recordAuditEffect('authorization_denied', () => recordDenialAudit(c, declaration, decision.reason))
    }
    if (decision.status === 401) throw unauthorized('Unauthorized')
    throw forbidden('Forbidden')
  })
}

export function requirePermission(
  resource: string,
  action: string,
  opts: { minTeamRole?: TeamRole; allowDownloader?: boolean } = {},
) {
  const scope = authorizationScope(resource, action)
  if (!scope) throw new Error(`Unknown authorization scope: ${resource}:${action}`)
  return authorize({
    access: 'protected',
    scopes: [scope],
    minTeamRole: opts.minTeamRole,
    allowDownloader: opts.allowDownloader,
    auditDenied: true,
  })
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
  return declaration.access === 'protected' && declaration.auditDenied !== false
}

async function recordDenialAudit(
  c: Context<Env>,
  _declaration: RouteAuthorizationDeclaration,
  reason: AuthzDenialReason,
) {
  const context = c.get('authzContext')
  if (!context.actor) return
  const orgId = context.fixedOrgId ?? context.orgId ?? c.get('orgId')
  if (!orgId) return
  await c.get('deps').audit.record({
    orgId,
    userId: context.userId,
    actorType: context.actor.type,
    actorRef: context.actor.ref,
    action: 'authorization_denied',
    targetType: 'route',
    targetName: 'protected route',
    metadata: {
      method: c.req.method.toUpperCase(),
      credential: context.credential,
      reason,
    },
  })
}
