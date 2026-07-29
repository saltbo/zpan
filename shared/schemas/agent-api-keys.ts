import { z } from 'zod'
import {
  AGENT_API_KEY_SHORTCUT_SCOPES,
  AGENT_GRANTABLE_API_KEY_SCOPES,
  AgentApiKeyShortcut,
} from '../api-key-templates'
import { AuthorizationScope } from '../authorization'

export const agentGrantableScopeSchema = z.enum(AGENT_GRANTABLE_API_KEY_SCOPES)
export type AgentGrantableScope = z.infer<typeof agentGrantableScopeSchema>

export const agentApiKeyShortcutSchema = z.enum(Object.values(AgentApiKeyShortcut))
export type AgentApiKeyShortcutInput = z.infer<typeof agentApiKeyShortcutSchema>

export const agentApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(agentGrantableScopeSchema).min(1),
  expiresAt: z.string().datetime(),
})
export type AgentApiKeyCreateInput = z.infer<typeof agentApiKeyCreateSchema>

export const agentApiKeyRotateSchema = agentApiKeyCreateSchema.partial({ name: true, scopes: true, expiresAt: true })
export type AgentApiKeyRotateInput = z.infer<typeof agentApiKeyRotateSchema>

export const agentApiKeyStatusSchema = z.enum(['active', 'expired', 'revoked', 'inaccessible'])
export type AgentApiKeyStatus = z.infer<typeof agentApiKeyStatusSchema>

export const agentApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  orgId: z.string(),
  workspaceName: z.string().nullable(),
  scopes: z.array(agentGrantableScopeSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  status: agentApiKeyStatusSchema,
})
export type AgentApiKey = z.infer<typeof agentApiKeySchema>

export const agentApiKeyListSchema = z.object({
  items: z.array(agentApiKeySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export type AgentApiKeyList = z.infer<typeof agentApiKeyListSchema>

export const agentApiKeyCreatedSchema = z.object({
  key: z.string(),
  item: agentApiKeySchema,
})
export type AgentApiKeyCreated = z.infer<typeof agentApiKeyCreatedSchema>

export const agentApiKeyShortcutOptions = Object.entries(AGENT_API_KEY_SHORTCUT_SCOPES).map(([id, scopes]) => ({
  id: id as AgentApiKeyShortcutInput,
  scopes: [...scopes],
}))

export const agentScopeLabels = {
  [AuthorizationScope.OBJECTS_READ]: 'objects:read',
  [AuthorizationScope.OBJECTS_CREATE]: 'objects:create',
  [AuthorizationScope.OBJECTS_UPDATE]: 'objects:update',
  [AuthorizationScope.OBJECTS_DELETE]: 'objects:delete',
  [AuthorizationScope.SHARES_READ]: 'shares:read',
  [AuthorizationScope.SHARES_CREATE]: 'shares:create',
  [AuthorizationScope.SHARES_DELETE]: 'shares:delete',
  [AuthorizationScope.QUOTA_READ]: 'quota:read',
  [AuthorizationScope.STORAGE_USAGE_READ]: 'storage-usage:read',
} as const satisfies Record<AgentGrantableScope, string>
