import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import type { AgentOAuthGrant } from './ports'
import { notFound } from './ports'

export async function listAgentOAuthGrants(
  deps: Pick<Deps, 'agentOAuth'>,
  db: Database,
  input: { userId: string },
): Promise<{ items: AgentOAuthGrant[] }> {
  return { items: await deps.agentOAuth.listGrants(db, input.userId) }
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
