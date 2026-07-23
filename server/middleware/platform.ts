import { createMiddleware } from 'hono/factory'
import type { Auth } from '../auth'
import type { WebDavMountPath } from '../domain/webdav-public-url'
import type { Platform } from '../platform/interface'
import type { Deps } from '../usecases/deps'

export type Env = {
  Variables: {
    platform: Platform
    auth: Auth
    deps: Deps
    principal: AuthPrincipal | null
    userId: string | null
    userRole: string | null
    orgId: string | null
    sitePublicOrigin: string | null
    webDavDomain: string
    webDavMountPath: WebDavMountPath
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

export const platformMiddleware = (platform: Platform, auth: Auth) =>
  createMiddleware<Env>(async (c, next) => {
    c.set('platform', platform)
    c.set('auth', auth)
    c.set('principal', null)
    c.set('errorLog', null)
    c.set('sitePublicOrigin', null)
    c.set('webDavDomain', '')
    c.set('webDavMountPath', '/dav')
    await next()
  })
