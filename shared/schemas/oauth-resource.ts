import { z } from 'zod'
import { AuthorizationScope } from '../authorization'
import { OAUTH_RESOURCE_SCOPES } from '../oauth'

export const oauthResourceScopeSchema = z.enum(OAUTH_RESOURCE_SCOPES)
export type OAuthResourceScope = z.infer<typeof oauthResourceScopeSchema>

export const oauthResourceScopeLabels = {
  [AuthorizationScope.OBJECTS_READ]: 'settings.oauthApps.scope.objectsRead',
  [AuthorizationScope.OBJECTS_CREATE]: 'settings.oauthApps.scope.objectsCreate',
  [AuthorizationScope.OBJECTS_UPDATE]: 'settings.oauthApps.scope.objectsUpdate',
  [AuthorizationScope.OBJECTS_DELETE]: 'settings.oauthApps.scope.objectsDelete',
  [AuthorizationScope.SHARES_READ]: 'settings.oauthApps.scope.sharesRead',
  [AuthorizationScope.SHARES_CREATE]: 'settings.oauthApps.scope.sharesCreate',
  [AuthorizationScope.SHARES_DELETE]: 'settings.oauthApps.scope.sharesDelete',
  [AuthorizationScope.QUOTA_READ]: 'settings.oauthApps.scope.quotaRead',
  [AuthorizationScope.QUOTA_PURCHASE]: 'settings.oauthApps.scope.quotaPurchase',
  [AuthorizationScope.STORAGE_USAGE_READ]: 'settings.oauthApps.scope.storageUsageRead',
} as const satisfies Record<OAuthResourceScope, string>
