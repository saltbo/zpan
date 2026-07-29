import {
  type AgentGrantableScope,
  type AgentOAuthGrant as AgentOAuthGrantDTO,
  agentGrantableScopeSchema,
  agentOAuthGrantDTO,
} from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { notFound } from './ports'

export async function listAgentOAuthGrants(
  deps: Pick<Deps, 'agentOAuth' | 'org'>,
  db: Database,
  input: { userId: string },
): Promise<{ items: AgentOAuthGrantDTO[] }> {
  const items = await deps.agentOAuth.listGrants(db, input.userId)
  const orgNames = await deps.org.getOrgNames(items.map((item) => item.orgId))
  return {
    items: items.map((item) =>
      agentOAuthGrantDTO({
        ...item,
        scopes: item.scopes.filter(isAgentGrantableScope),
        workspaceName: orgNames.get(item.orgId) ?? null,
      }),
    ),
  }
}

function isAgentGrantableScope(scope: string): scope is AgentGrantableScope {
  return agentGrantableScopeSchema.safeParse(scope).success
}

export async function revokeAgentOAuthGrant(
  deps: Pick<Deps, 'agentOAuth'>,
  db: Database,
  input: { userId: string; grantId: string; now?: Date },
): Promise<void> {
  const revoked = await deps.agentOAuth.revokeGrant(db, {
    userId: input.userId,
    grantId: input.grantId,
    now: input.now ?? new Date(),
  })
  if (!revoked) throw notFound('Agent OAuth grant not found')
}
