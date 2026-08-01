import {
  type OAuthGrant as OAuthGrantDTO,
  type OAuthResourceScope,
  oauthGrantDTO,
  oauthResourceScopeSchema,
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
  const orgNames = await deps.org.getOrgNames(items.map((item) => item.orgId))
  return {
    items: items.map((item) =>
      oauthGrantDTO({
        ...item,
        scopes: item.scopes.filter(isOAuthResourceScope),
        workspaceName: orgNames.get(item.orgId) ?? null,
      }),
    ),
  }
}

function isOAuthResourceScope(scope: string): scope is OAuthResourceScope {
  return oauthResourceScopeSchema.safeParse(scope).success
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
