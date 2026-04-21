import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization, username } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { adminAc, memberAc, ownerAc } from 'better-auth/plugins/organization/access'
import { count, eq, like } from 'drizzle-orm'
import { customAlphabet, nanoid } from 'nanoid'
import { SignupMode } from '../shared/constants'
import {
  BUILTIN_PROVIDER_IDS,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  parseProviderConfig,
} from '../shared/oauth-providers'
import * as authSchema from './db/auth-schema'
import { orgQuotas, systemOptions } from './db/schema'
import { hashPassword, verifyPassword as verifyPasswordHash } from './lib/password'
import type { Database } from './platform/interface'
import { sendEmail } from './services/email'
import { redeemInviteCode, validateInviteCode } from './services/invite'
import { findPersonalOrg } from './services/org'

// better-auth's default password hasher is pure-JS scrypt from @noble/hashes,
// which blows past Cloudflare Workers' CPU budget and triggers error 1102.
// We use node:crypto.scryptSync via server/lib/password.ts (native OpenSSL,
// counted as I/O rather than JS CPU time on CF Workers).

async function authHashPassword(password: string): Promise<string> {
  return hashPassword(password)
}

async function authVerifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (!hash.includes(':')) throw new Error('stored password hash is malformed: expected "<salt>:<key>"')
  return verifyPasswordHash(hash, password)
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

const _INVITE_CODE_ERRORS: Record<string, string> = {
  not_found: 'Invalid invite code',
  already_used: 'Invite code already used',
  expired: 'Invite code expired',
}

function buildInvitationEmailHtml(data: {
  email: string
  role: string
  organization: { name: string }
  inviter: { user: { name: string; email: string } }
  id: string
}): string {
  const orgName = data.organization.name
  const inviterName = data.inviter.user.name || data.inviter.user.email
  const acceptUrl = `/api/auth/organization/accept-invitation/${data.id}`
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">You've been invited to join ${orgName}</h2>
<p style="color:#555;line-height:1.5">${inviterName} has invited you to join <strong>${orgName}</strong> as <strong>${data.role}</strong>.</p>
<a href="${acceptUrl}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Accept Invitation</a>
<p style="color:#999;font-size:13px">If you did not expect this invitation, you can safely ignore this email.</p>
</div>`
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
        hash: authHashPassword,
        verify: authVerifyPassword,
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
      organization({
        roles: {
          owner: ownerAc,
          admin: adminAc,
          member: memberAc,
          editor: memberAc,
          viewer: memberAc,
        },
        sendInvitationEmail: async (data) => {
          if (!(await isEmailConfigured(db))) return
          await sendEmail(db, {
            to: data.email,
            subject: `You've been invited to join ${data.organization.name} - ZPan`,
            html: buildInvitationEmailHtml(data),
          })
        },
      }),
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
      apiKey({
        // Keys belong to the organization, not the individual user
        references: 'organization',
        // Rate limiting and lastRequest tracking are on by default
        rateLimit: { enabled: true },
        // Declare the image-hosting:upload permission so upload routes can require it
        permissions: {
          defaultPermissions: { 'image-hosting': ['upload'] },
        },
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
                const inviteCode = (context?.body as { inviteCode?: string })?.inviteCode
                if (!inviteCode) {
                  throw new Error('An invite code is required to register')
                }
                const validation = await validateInviteCode(db, inviteCode)
                if (!validation.valid) {
                  throw new Error(validation.error ?? 'Invalid invite code')
                }
              }
            }

            // Promote the very first signup to admin BEFORE the INSERT so the
            // role is baked into the session cookie that the response returns.
            const data: Record<string, unknown> = firstUser ? { ...user, role: 'admin' } : { ...user }

            // For OAuth sign-ups, generate username before INSERT.
            // Email sign-ups already have username from the registration form.
            if (!data.username) {
              const raw = user as Record<string, unknown>
              data.username = await generateUsername(db, {
                oauthUsername: String(raw.preferred_username ?? raw.login ?? ''),
                email: String(user.email ?? ''),
              })
              data.displayUsername = data.username
            }

            return { data }
          },
          after: async (user, context) => {
            // Redeem invite code after user is created (user.id is now available)
            const mode = await getSignupMode(db)
            if (mode === SignupMode.INVITE_ONLY) {
              const inviteCode = (context?.body as { inviteCode?: string })?.inviteCode
              if (inviteCode) {
                await redeemInviteCode(db, inviteCode, user.id)
              }
            }

            // Create personal org as part of registration.
            // This hook is deferred until after the transaction commits, so
            // when autoSignIn is enabled the org is actually created by
            // session.create.before (which runs earlier, inside the txn).
            // The idempotent check ensures no duplicate is created.
            const existing = await findPersonalOrg(db, user.id)
            if (!existing) {
              await createPersonalOrg(db, user)
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Look up existing personal org (returning users)
            let orgId = await findPersonalOrg(db, session.userId)

            // For new sign-ups the org doesn't exist yet — create it now.
            // This runs inside the sign-up transaction, after the user row
            // is inserted but before the session row and cookie cache are
            // written, so activeOrganizationId is correct from the start.
            if (!orgId) {
              // Only create if the org row doesn't already exist. The org
              // could exist without membership (e.g. admin revoked access).
              const slug = `personal-${session.userId}`
              const [existing] = await db
                .select({ id: authSchema.organization.id })
                .from(authSchema.organization)
                .where(eq(authSchema.organization.slug, slug))
                .limit(1)

              if (!existing) {
                const [user] = await db
                  .select({ id: authSchema.user.id, name: authSchema.user.name, username: authSchema.user.username })
                  .from(authSchema.user)
                  .where(eq(authSchema.user.id, session.userId))
                if (user) {
                  orgId = await createPersonalOrg(db, user)
                }
              }
            }

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

const generateRandomSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30)
  // Must contain at least one alphanumeric character
  return /[a-z0-9]/.test(cleaned) ? cleaned : ''
}

async function tryUsername(db: Database, candidate: string): Promise<boolean> {
  const rows = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.username, candidate))
    .limit(1)
  return rows.length === 0
}

async function generateUsername(db: Database, opts: { oauthUsername?: string; email?: string }): Promise<string> {
  // 1. Try OAuth username (OIDC: preferred_username; GitHub/Gitea: login)
  const oauthName = sanitizeUsername(opts.oauthUsername ?? '')
  if (oauthName.length >= 3 && (await tryUsername(db, oauthName))) return oauthName

  // 2. Try email prefix
  const emailPrefix = sanitizeUsername((opts.email ?? '').split('@')[0])
  if (emailPrefix.length >= 3 && (await tryUsername(db, emailPrefix))) return emailPrefix

  // 3. Fallback: best available prefix + random suffix
  const base = oauthName || emailPrefix || 'user'
  return `${base}-${generateRandomSuffix()}`
}

async function createPersonalOrg(
  db: Database,
  user: { id: string; name: string; username?: string | null },
): Promise<string> {
  const orgId = nanoid()
  const now = new Date()
  const displayName = user.name || user.username
  const orgName = displayName ? `${displayName}'s Space` : 'Personal Space'
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

  return orgId
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
