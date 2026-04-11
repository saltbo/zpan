import crypto from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as authSchema from './db/auth-schema'
import type { Database } from './platform/interface'

// better-auth's default password hasher is pure-JS scrypt from @noble/hashes,
// which blows past Cloudflare Workers' CPU budget and triggers error 1102.
// node:crypto.scryptSync is native (OpenSSL) on both Node and Workers
// (via nodejs_compat) and is counted as I/O rather than JS CPU time on CF.
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, 64, SCRYPT_PARAMS)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':')
  if (!saltHex || !keyHex) return false
  const key = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 64, SCRYPT_PARAMS)
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'))
}

export function createAuth(db: Database, secret: string, baseURL?: string, trustedOrigins?: string[]) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
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
