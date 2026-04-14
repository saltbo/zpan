import crypto from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization, username } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { count, eq, like } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { SignupMode } from '../shared/constants'
import {
  BUILTIN_PROVIDER_IDS,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  parseProviderConfig,
} from '../shared/oauth-providers'
import * as authSchema from './db/auth-schema'
import { orgQuotas, systemOptions } from './db/schema'
import type { Database } from './platform/interface'
import { sendEmail } from './services/email'
import { redeemInviteCode } from './services/invite'
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

async function getSignupMode(db: Database): Promise<SignupMode> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'auth_signup_mode'))
  const raw = rows[0]?.value
  if (raw === SignupMode.INVITE_ONLY || raw === SignupMode.CLOSED) return raw
  return SignupMode.OPEN
}

async function isEmailConfigured(db: Database): Promise<boolean> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'email_provider'))
  return !!rows[0]?.value
}

const INVITE_CODE_ERRORS: Record<string, string> = {
  not_found: 'Invalid invite code',
  already_used: 'Invite code already used',
  expired: 'Invite code expired',
}

function buildVerificationEmailHtml(url: string): string {
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error(`Verification URL has unsafe protocol: ${url}`)
  }
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">Verify your email</h2>
<p style="color:#555;line-height:1.5">Click the button below to verify your email address and activate your account.</p>
<a href="${url}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Verify Email</a>
<p style="color:#999;font-size:13px">If you didn't create an account, you can safely ignore this email.</p>
</div>`
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
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        if (!(await isEmailConfigured(db))) return
        await sendEmail(db, {
          to: user.email,
          subject: 'Verify your email - ZPan',
          html: buildVerificationEmailHtml(url),
        })
      },
      autoSignInAfterVerification: true,
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
          before: async (user, context) => {
            const firstUser = await isFirstUser(db)

            // Registration gate: skip for the very first user so bootstrap works
            if (!firstUser) {
              const mode = await getSignupMode(db)
              if (mode === SignupMode.CLOSED) {
                throw new Error('Registration is currently closed')
              }
              if (mode === SignupMode.INVITE_ONLY) {
                // Read inviteCode from the request body via the endpoint context
                const body = context
                  ? await context.request
                      ?.clone()
                      .json()
                      .catch(() => ({}))
                  : {}
                const inviteCode = (body as { inviteCode?: string }).inviteCode
                if (!inviteCode) {
                  throw new Error('An invite code is required to register')
                }
                const result = await redeemInviteCode(db, inviteCode, user.id)
                if (result !== 'ok') {
                  throw new Error(INVITE_CODE_ERRORS[result] ?? 'Invalid invite code')
                }
              }
            }

            // Promote the very first signup to admin BEFORE the INSERT so the
            // role is baked into the session cookie that the response returns.
            return { data: firstUser ? { ...user, role: 'admin' } : user }
          },
          after: async (user) => {
            await createPersonalOrg(db, user)
          },
        },
      },
      session: {
        create: {
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
