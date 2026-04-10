import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
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
    plugins: [admin(), organization()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await setupNewUser(db, user)
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>

async function setupNewUser(db: Database, user: { id: string; name: string }) {
  await promoteFirstUserToAdmin(db, user.id)
  await createPersonalOrg(db, user)
}

async function promoteFirstUserToAdmin(db: Database, userId: string): Promise<void> {
  await db.run(sql`UPDATE user SET role = 'admin' WHERE id = ${userId} AND (SELECT COUNT(*) FROM user) = 1`)
}

async function createPersonalOrg(db: Database, user: { id: string; name: string }): Promise<void> {
  const orgId = nanoid()
  const now = new Date()
  const orgName = user.name ? `${user.name}'s Space` : 'Personal Space'

  await db.insert(authSchema.organization).values({
    id: orgId,
    name: orgName,
    slug: `personal-${user.id}`,
    metadata: JSON.stringify({ type: 'personal' }),
    createdAt: now,
  })

  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId: orgId,
    userId: user.id,
    role: 'owner',
    createdAt: now,
  })
}
