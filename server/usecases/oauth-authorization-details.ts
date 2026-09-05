import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import type { JWTPayload } from 'jose'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { forbidden, unauthorized } from './ports'

type CatalogDeps = Pick<Deps, 'oauth' | 'org' | 'userAdmin'>

export async function listOAuthAuthorizationDetailsCatalog(
  deps: CatalogDeps,
  input: {
    db: Database
    token: string
    page: number
    pageSize: number
    verifyJwtToken: () => Promise<JWTPayload>
  },
) {
  const account =
    (await deps.oauth.resolveAccountAccessToken(input.db, input.token)) ??
    (await resolveJwtAccountToken(deps, input.db, input.verifyJwtToken))
  if (!account) throw unauthorized('Unauthorized')
  if (!account.scopes.includes(AuthorizationScope.WORKSPACES_DISCOVER)) throw forbidden('Forbidden')

  const workspaces = await deps.org.listUserWorkspaceCatalog(account.userId)
  const offset = (input.page - 1) * input.pageSize
  const items = workspaces.slice(offset, offset + input.pageSize).map((workspace) => ({
    id: workspace.id,
    authorizationDetail: {
      type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE as typeof WORKSPACE_AUTHORIZATION_DETAIL_TYPE,
      identifier: workspace.id,
    },
    display: {
      label: workspace.name,
      metadata: { type: workspace.type, role: workspace.role },
    },
  }))
  return {
    items,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      totalItems: workspaces.length,
      totalPages: Math.ceil(workspaces.length / input.pageSize),
    },
  }
}

async function resolveJwtAccountToken(deps: CatalogDeps, db: Database, verifyJwtToken: () => Promise<JWTPayload>) {
  try {
    const payload = await verifyJwtToken()
    if (payload.act !== undefined || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null
    const clientId =
      typeof payload.client_id === 'string' ? payload.client_id : typeof payload.azp === 'string' ? payload.azp : null
    const client = clientId ? await deps.oauth.findClient(db, clientId) : null
    if (!client || client.disabled || (await deps.oauth.isJwtAccessTokenRevoked(db, payload.jti))) return null
    if (await deps.userAdmin.isBanned(payload.sub)) return null
    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope
            .split(/\s+/)
            .filter((scope): scope is AuthorizationScope =>
              Object.values(AuthorizationScope).includes(scope as AuthorizationScope),
            )
        : []
    return { clientId, userId: payload.sub, scopes }
  } catch {
    return null
  }
}
