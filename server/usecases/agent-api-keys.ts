import { AGENT_GRANTABLE_API_KEY_SCOPES } from '@shared/api-key-templates'
import type {
  AgentApiKeyCreated,
  AgentApiKeyCreateInput,
  AgentApiKeyList,
  AgentApiKeyRotateInput,
  AgentGrantableScope,
} from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { badRequest, forbidden, notFound } from './ports'

const MAX_AGENT_API_KEY_AGE_MS = 365 * 24 * 60 * 60 * 1000
const AGENT_GRANTABLE_SCOPE_SET = new Set<string>(AGENT_GRANTABLE_API_KEY_SCOPES)

export async function listAgentApiKeys(
  deps: Pick<Deps, 'apiKeys' | 'org'>,
  db: Database,
  input: { userId: string; orgId: string; page: number; pageSize: number; now?: Date },
): Promise<AgentApiKeyList> {
  await requireWorkspaceManager(deps, input.userId, input.orgId)
  const items = await deps.apiKeys.listAgentApiKeys(db, input.userId, input.orgId, input.now ?? new Date())
  const offset = (input.page - 1) * input.pageSize
  return {
    items: items.slice(offset, offset + input.pageSize),
    total: items.length,
    page: input.page,
    pageSize: input.pageSize,
  }
}

export async function createAgentApiKey(
  deps: Pick<Deps, 'apiKeys' | 'org'>,
  db: Database,
  input: { userId: string; orgId: string; body: AgentApiKeyCreateInput; now?: Date },
): Promise<AgentApiKeyCreated> {
  const now = input.now ?? new Date()
  await requireWorkspaceManager(deps, input.userId, input.orgId)
  return deps.apiKeys.issueAgentApiKey(db, {
    name: input.body.name,
    orgId: input.orgId,
    userId: input.userId,
    scopes: normalizeScopes(input.body.scopes),
    expiresAt: parseExpiresAt(input.body.expiresAt, now),
  })
}

export async function rotateAgentApiKey(
  deps: Pick<Deps, 'apiKeys' | 'org'>,
  db: Database,
  input: { userId: string; orgId: string; keyId: string; body: AgentApiKeyRotateInput; now?: Date },
): Promise<AgentApiKeyCreated> {
  const now = input.now ?? new Date()
  await requireWorkspaceManager(deps, input.userId, input.orgId)
  const existing = await deps.apiKeys.getAgentApiKey(db, input.userId, input.orgId, input.keyId, now)
  if (!existing) throw notFound('Agent API key not found')
  return deps.apiKeys.issueAgentApiKey(db, {
    name: input.body.name?.trim() || `${existing.name} rotation`,
    orgId: input.orgId,
    userId: input.userId,
    scopes: normalizeScopes(input.body.scopes ?? existing.scopes),
    expiresAt: parseExpiresAt(input.body.expiresAt ?? existing.expiresAt, now),
    revokeKeyId: existing.id,
  })
}

export async function revokeAgentApiKey(
  deps: Pick<Deps, 'apiKeys' | 'org'>,
  db: Database,
  input: { userId: string; orgId: string; keyId: string; now?: Date },
): Promise<void> {
  await requireWorkspaceManager(deps, input.userId, input.orgId)
  const existing = await deps.apiKeys.getAgentApiKey(
    db,
    input.userId,
    input.orgId,
    input.keyId,
    input.now ?? new Date(),
  )
  if (!existing) throw notFound('Agent API key not found')
  await deps.apiKeys.revokeAgentApiKey(db, input.keyId)
}

async function requireWorkspaceManager(deps: Pick<Deps, 'org'>, userId: string, orgId: string): Promise<void> {
  if (!(await deps.org.canWriteToOrg(userId, orgId))) throw forbidden('Editor access to the workspace is required')
}

function parseExpiresAt(value: string, now: Date): Date {
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) throw badRequest('Invalid expiry')
  if (expiresAt <= now) throw badRequest('Agent API key expiry must be in the future')
  if (expiresAt.getTime() - now.getTime() > MAX_AGENT_API_KEY_AGE_MS) {
    throw badRequest('Agent API key expiry cannot exceed one year')
  }
  return expiresAt
}

function normalizeScopes(scopes: readonly string[]): AgentGrantableScope[] {
  const unique = new Set(scopes)
  if (unique.size !== scopes.length) throw badRequest('Duplicate Agent API key scopes are not allowed')
  const normalized = [...unique] as AgentGrantableScope[]
  if (normalized.some((scope) => !AGENT_GRANTABLE_SCOPE_SET.has(scope))) {
    throw badRequest('Agent API key scope is not grantable')
  }
  return normalized
}
