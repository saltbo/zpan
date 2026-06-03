import { createMiddleware } from 'hono/factory'
import type { Auth } from '../auth'
import type { Platform } from '../platform/interface'

export type Env = {
  Variables: {
    platform: Platform
    auth: Auth
    principal: AuthPrincipal | null
    userId: string | null
    userRole: string | null
    orgId: string | null
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
    await next()
  })
