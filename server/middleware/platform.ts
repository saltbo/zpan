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
    requestId: string
    // Structured detail for the access log on a failed request. Set by `jsonError`
    // (via `app.onError`); read by the accessLog middleware so every 4xx/5xx carries
    // its reason + full message, not just unhandled crashes.
    errorLog: { reason: string; message: string; diagnostic?: string } | null
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
      kind: 'oauth'
      actorIssuer: string
      actorSubject: string
      clientId: string
      orgId: string
      userId: string
      scopes: readonly AuthorizationScope[]
      authMethod: 'bearer' | 'dpop'
    }
  | {
      kind: 'downloader'
      downloaderId: string
      authMethod: 'bearer'
    }
  | {
      kind: 'downloader-bootstrap'
      userId: string
      sessionToken: string
      scope: 'downloader:register'
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

export type AuthzWorkspace =
  | { mode: 'none'; orgId: null }
  | { mode: 'selected'; orgId: string | null }
  | { mode: 'bound'; orgId: string }

export type AuthzContext =
  | {
      credential: 'anonymous'
      userId: null
      workspace: { mode: 'none'; orgId: null }
      grantedScopes: null
      actor: null
    }
  | {
      credential: 'session'
      userId: string
      workspace: { mode: 'selected'; orgId: string | null }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'user'; ref: string }
      state: { firstParty: true; role?: string }
    }
  | {
      credential: 'api_key'
      userId: string
      workspace: { mode: 'none'; orgId: null } | { mode: 'bound'; orgId: string }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'api_key'; ref: string }
      state: { configId: string; enabled: true; role?: string }
    }
  | {
      credential: 'oauth'
      userId: string
      workspace: { mode: 'bound'; orgId: string }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'oauth'; ref: string; issuer: string }
      state: { clientId: string; role?: string }
    }
  | {
      credential: 'downloader'
      userId: null
      workspace: { mode: 'none'; orgId: null }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'downloader'; ref: string }
      state: Record<string, unknown>
    }
  | {
      credential: 'downloader-bootstrap'
      userId: string
      workspace: { mode: 'none'; orgId: null }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'user'; ref: string }
      state: { clientId: 'zpan-cli'; scope: 'downloader:register'; role?: string }
    }
  | {
      credential: 'download-task-upload'
      userId: string
      workspace: { mode: 'bound'; orgId: string }
      grantedScopes: ReadonlySet<AuthorizationScope>
      actor: { type: 'task-upload'; ref: string }
      state: { downloaderId: string; taskId: string }
    }

export function workspaceOrgId(context: AuthzContext): string | null {
  return context.workspace.orgId
}

export function boundWorkspaceOrgId(context: AuthzContext): string | null {
  return context.workspace.mode === 'bound' ? context.workspace.orgId : null
}

export const anonymousAuthzContext = (): AuthzContext => ({
  credential: 'anonymous',
  userId: null,
  workspace: { mode: 'none', orgId: null },
  grantedScopes: null,
  actor: null,
})

export const platformMiddleware = (platform: Platform, auth: Auth) =>
  createMiddleware<Env>(async (c, next) => {
    const requestId = crypto.randomUUID()
    c.set('requestId', requestId)
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
    try {
      await next()
    } finally {
      c.header('Request-Id', requestId)
    }
  })
