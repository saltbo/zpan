import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as authSchema from './db/auth-schema'
import type { Database } from './platform/interface'

export function createAuth(db: Database, secret: string, baseURL?: string, trustedOrigins?: string[]) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
