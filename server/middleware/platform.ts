import type { AuthorizationScope } from '@shared/authorization'
import { createMiddleware } from 'hono/factory'
import type { Auth } from '../auth'
import type { DavLock } from '../domain/webdav'
import type { WebDavMountPath } from '../domain/webdav-public-url'
import type { Platform } from '../platform/interface'
import type { Deps } from '../usecases/deps'
import type { WebDavTarget } from '../usecases/ports'
import type { TransferAuditTarget } from '../usecases/transfer-activity'

export type Env = {
  Variables: {
    platform: Platform
    auth: Auth
    deps: Deps
    principal: AuthPrincipal | null
    authzContext: AuthzContext
    userId: string | null
    userRole: string | null
    orgId: string | null
    sitePublicOrigin: string | null
    webDavEnabled: boolean
    webDavDomain: string
    webDavMountPath: WebDavMountPath
    webDavTrace: string[]
    webDavDownloadAuditTarget: TransferAuditTarget | null
    webDavResolvedPutTarget: WebDavTarget | null
    webDavUploadAuditTarget: TransferAuditTarget | null
    webDavLocksByResource: Map<string, DavLock[]>
    // Structured detail for the access log on a failed request. Set by `jsonError`
    // (via `app.onError`); read by the accessLog middleware so every 4xx/5xx carries
    // its reason + full message, not just unhandled crashes.
    errorLog: { reason: string; message: string } | null
  }
}

export type AuthPrincipal =
  | {
      kind: 'user'
      userId: string
      role?: string
      orgId: string | null
      authMethod: 'cookie' | 'bearer'
    }
  | {
      kind: 'api-key'
      keyId: string
      configId: string
      orgId: string | null
      userId: string
      scope: import('@shared/api-key-templates').ApiKeyScope
      permissions: Record<string, string[]> | null
      authMethod: 'api-key'
    }
  | {
      kind: 'downloader'
      downloaderId: string
      authMethod: 'bearer'
    }
  | {
      kind: 'download-task-upload'
      downloaderId: string
      taskId: string
      orgId: string
      targetFolder: string
      createdByUserId: string
      scopes: string[]
      authMethod: 'bearer'
    }

export type AuthzContext =
  | { credential: 'anonymous'; userId: null; orgId: null; fixedOrgId: null; grantedScopes: null; actor: null }
  | {
      credential: 'session'
      userId: string
      orgId: string | null
      fixedOrgId: null
      grantedScopes: null
      actor: { type: 'user'; ref: string }
      state: { firstParty: true; role?: string }
    }
  | {
      credential: 'api_key'
      userId: string
      orgId: string | null
      fixedOrgId: string | null
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'api_key'; ref: string }
      state: { configId: string; enabled: true }
    }
  | {
      credential: 'downloader'
      userId: null
      orgId: null
      fixedOrgId: null
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'downloader'; ref: string }
      state: Record<string, unknown>
    }
  | {
      credential: 'download-task-upload'
      userId: string
      orgId: string
      fixedOrgId: string
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'task-upload'; ref: string }
      state: { downloaderId: string; taskId: string }
    }

export const anonymousAuthzContext = (): AuthzContext => ({
  credential: 'anonymous',
  userId: null,
  orgId: null,
  fixedOrgId: null,
  grantedScopes: null,
  actor: null,
})

export const platformMiddleware = (platform: Platform, auth: Auth) =>
  createMiddleware<Env>(async (c, next) => {
    c.set('platform', platform)
    c.set('auth', auth)
    c.set('principal', null)
    c.set('authzContext', anonymousAuthzContext())
    c.set('errorLog', null)
    c.set('sitePublicOrigin', null)
    c.set('webDavEnabled', false)
    c.set('webDavDomain', '')
    c.set('webDavMountPath', '/dav')
    c.set('webDavTrace', [])
    c.set('webDavDownloadAuditTarget', null)
    c.set('webDavResolvedPutTarget', null)
    c.set('webDavUploadAuditTarget', null)
    c.set('webDavLocksByResource', new Map())
    await next()
  })
