import type { ApiKeyPermissions, ApiKeyScope } from '@shared/api-key-templates'
import type { Database } from '../../platform/interface'

export interface VerifiedApiKey {
  id: string
  configId: string
  referenceId: string
  scope: ApiKeyScope
  permissions: ApiKeyPermissions | null
}

// Structural view of better-auth used by the gateway. Keeps the port free of the
// better-auth framework type while letting callers pass the real `Auth`.
export interface ApiKeyAuth {
  api: Record<string, unknown>
}

// Thrown by the gateway when better-auth reports the key is rate limited. The
// http layer (business routes + WebDAV) maps it to 429 with Retry-After.
export class ApiKeyRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ApiKeyRateLimitError'
  }
}

export interface ApiKeyGateway {
  verifyApiKey(auth: ApiKeyAuth, db: Database, key: string, configId?: string): Promise<VerifiedApiKey | null>
  verifyApiKeyForPermission(
    auth: ApiKeyAuth,
    db: Database,
    key: string,
    resource: string,
    action: string,
    configId?: string,
  ): Promise<VerifiedApiKey | null>
  hasApiKeyPermission(permissions: ApiKeyPermissions | null | undefined, resource: string, action: string): boolean
}
