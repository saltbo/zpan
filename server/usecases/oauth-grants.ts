import {
  type OAuthGrant as OAuthGrantDTO,
  type OAuthGrantScope,
  oauthGrantDTO,
  oauthGrantScopeSchema,
} from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { notFound } from './ports'

export async function listOAuthGrants(
  deps: Pick<Deps, 'oauth' | 'org'>,
  db: Database,
  input: { userId: string },
): Promise<{ items: OAuthGrantDTO[] }> {
  const items = await deps.oauth.listGrants(db, input.userId)
  const workspaceIds = [...new Set(items.flatMap((item) => item.workspaceIds))]
  const orgNames = await deps.org.getOrgNames(workspaceIds)
  return {
    items: items.map((item) => {
      const { workspaceIds: itemWorkspaceIds, ...grant } = item
      return oauthGrantDTO({
        ...grant,
        scopes: item.scopes.filter(isOAuthGrantScope),
        workspaces: itemWorkspaceIds.map((id) => ({ id, name: orgNames.get(id) ?? null })),
      })
    }),
  }
}

function isOAuthGrantScope(scope: string): scope is OAuthGrantScope {
  return oauthGrantScopeSchema.safeParse(scope).success
}

export async function revokeOAuthGrant(
  deps: Pick<Deps, 'oauth'>,
  db: Database,
  input: { userId: string; grantId: string; now?: Date },
): Promise<void> {
  const revoked = await deps.oauth.revokeGrant(db, {
    userId: input.userId,
    grantId: input.grantId,
    now: input.now ?? new Date(),
  })
  if (!revoked) throw notFound('OAuth grant not found')
}
