import { z } from 'zod'
import { AGENT_OAUTH_RESOURCE_SCOPES } from '../agent-oauth'
import { AuthorizationScope } from '../authorization'

export const oauthResourceScopeSchema = z.enum(AGENT_OAUTH_RESOURCE_SCOPES)
export type OAuthResourceScope = z.infer<typeof oauthResourceScopeSchema>

export const oauthResourceScopeLabels = {
  [AuthorizationScope.OBJECTS_READ]: 'settings.agentAccess.scope.objectsRead',
  [AuthorizationScope.OBJECTS_CREATE]: 'settings.agentAccess.scope.objectsCreate',
  [AuthorizationScope.OBJECTS_UPDATE]: 'settings.agentAccess.scope.objectsUpdate',
  [AuthorizationScope.OBJECTS_DELETE]: 'settings.agentAccess.scope.objectsDelete',
  [AuthorizationScope.SHARES_READ]: 'settings.agentAccess.scope.sharesRead',
  [AuthorizationScope.SHARES_CREATE]: 'settings.agentAccess.scope.sharesCreate',
  [AuthorizationScope.SHARES_DELETE]: 'settings.agentAccess.scope.sharesDelete',
  [AuthorizationScope.QUOTA_READ]: 'settings.agentAccess.scope.quotaRead',
  [AuthorizationScope.STORAGE_USAGE_READ]: 'settings.agentAccess.scope.storageUsageRead',
} as const satisfies Record<OAuthResourceScope, string>
