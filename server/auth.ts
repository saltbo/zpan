import crypto from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization, username } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { count, eq, like } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  BUILTIN_PROVIDER_IDS,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  parseProviderConfig,
} from '../shared/oauth-providers'
import * as authSchema from './db/auth-schema'
import { orgQuotas, systemOptions } from './db/schema'
import type { Database } from './platform/interface'
import { findPersonalOrg } from './services/org'

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
  if (!saltHex || !keyHex) {
    throw new Error('stored password hash is malformed: expected "<salt>:<key>"')
  }
  const key = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 64, SCRYPT_PARAMS)
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'))
}

async function loadProviderConfig(db: Database, providerId: string) {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, `${OAUTH_PROVIDER_KEY_PREFIX}${providerId}`))
  const raw = rows[0]?.value
  if (!raw) return null
  return parseProviderConfig(raw)
}

async function loadOidcConfigs(db: Database) {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(like(systemOptions.key, OAUTH_PROVIDER_KEY_PATTERN))
  const configs = []
  for (const r of rows) {
    const c = parseProviderConfig(r.value)
    if (c && c.type === 'oidc' && c.enabled) configs.push(c)
  }
  return configs
}

// All 35 built-in providers are registered as async functions so better-auth
// can resolve them on demand. Unconfigured providers return enabled: false
// and are ignored by the framework.
function buildDynamicSocialProviders(db: Database) {
  const providers: Record<string, () => Promise<{ clientId: string; clientSecret: string; enabled: boolean }>> = {}
  for (const id of BUILTIN_PROVIDER_IDS) {
    providers[id] = async () => {
      const config = await loadProviderConfig(db, id)
      if (!config?.enabled || config.type !== 'builtin') {
        return { clientId: '', clientSecret: '', enabled: false }
      }
      return { clientId: config.clientId, clientSecret: config.clientSecret, enabled: true }
    }
  }
  return providers
}

export async function createAuth(db: Database, secret: string, baseURL?: string, trustedOrigins?: string[]) {
  const oidcConfigs = await loadOidcConfigs(db)

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
    socialProviders: buildDynamicSocialProviders(db),
    plugins: [
      admin(),
      organization(),
      username(),
      genericOAuth({
        config: oidcConfigs.map((c) => ({
          providerId: c.providerId,
          clientId: c.clientId,
          clientSecret: c.clientSecret,
          discoveryUrl: c.discoveryUrl,
          scopes: c.scopes,
        })),
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Promote the very first signup to admin BEFORE the INSERT so the
          // role is baked into the session cookie that the response returns.
          // Running this in `after` left the first user with a stale `user`
          // role in their session cookie until they re-logged in.
          before: async (user) => {
            if (await isFirstUser(db)) {
              return { data: { ...user, role: 'admin' } }
            }
            return { data: user }
          },
          after: async (user) => {
            await createPersonalOrg(db, user)
          },
        },
      },
      session: {
        create: {
          // Pin every new session to the user's personal org so routes that
          // read activeOrganizationId from the cached session cookie don't
          // have to fall back to a DB lookup on every request.
          before: async (session) => {
            const orgId = await findPersonalOrg(db, session.userId)
            if (orgId) {
              return { data: { ...session, activeOrganizationId: orgId } }
            }
            return { data: session }
          },
        },
      },
    },
  })
}

export type Auth = Awaited<ReturnType<typeof createAuth>>

async function isFirstUser(db: Database): Promise<boolean> {
  const [row] = await db.select({ c: count() }).from(authSchema.user)
  if (!row) throw new Error('count(*) on user table returned no rows')
  return row.c === 0
}

async function createPersonalOrg(db: Database, user: { id: string; name: string }): Promise<void> {
  const orgId = nanoid()
  const now = new Date()
  const orgName = user.name ? `${user.name}'s Space` : 'Personal Space'
  const defaultQuota = await getDefaultOrgQuota(db)

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

  if (defaultQuota > 0) {
    await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota: defaultQuota, used: 0 })
  }
}

const DEFAULT_ORG_QUOTA = 10 * 1024 * 1024 // 10 MB

async function getDefaultOrgQuota(db: Database): Promise<number> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'default_org_quota'))
  const raw = rows[0]?.value
  if (raw == null) return DEFAULT_ORG_QUOTA
  const n = Number(raw)
  return Number.isFinite(n) ? n : DEFAULT_ORG_QUOTA
}
