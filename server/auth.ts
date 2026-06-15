import { apiKey } from '@better-auth/api-key'
import { APIError, type BetterAuthPlugin, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { CaptchaOptions } from 'better-auth/plugins'
import { admin, bearer, captcha, deviceAuthorization, organization, username } from 'better-auth/plugins'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { adminAc, memberAc, ownerAc } from 'better-auth/plugins/organization/access'
import { count, eq, like } from 'drizzle-orm'
import { customAlphabet, nanoid } from 'nanoid'
import {
  ApiKeyTemplate,
  IHOST_API_KEY_PERMISSIONS,
  REMOTE_DOWNLOAD_API_KEY_PERMISSIONS,
  WEBDAV_API_KEY_PERMISSIONS,
} from '../shared/api-key-templates'
import { DEFAULT_ORG_QUOTA, DEFAULT_ORG_TRAFFIC_QUOTA, SignupMode } from '../shared/constants'
import {
  BUILTIN_PROVIDER_IDS,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  type OAuthProviderConfig,
  parseProviderConfig,
} from '../shared/oauth-providers'
import { createEmailGateway } from './adapters/gateways/email'
import { createActivityRepo } from './adapters/repos/activity'
import { createInviteRepo } from './adapters/repos/invite'
import { createLicenseBindingRepo } from './adapters/repos/license-binding'
import { createMemberCountRepo } from './adapters/repos/member-count'
import { createNotificationRepo } from './adapters/repos/notification'
import { createOrgRepo } from './adapters/repos/org'
import { createSiteInvitationRepo } from './adapters/repos/site-invitations'
import { createSystemOptionsRepo } from './adapters/repos/system-options'
import * as authSchema from './db/auth-schema'
import { orgQuotaEntitlements, orgQuotas, systemOptions } from './db/schema'
import { executeWriteTransaction } from './db/transaction'
import { CAPTCHA_AUTH_ENDPOINTS, type CaptchaConfig } from './domain/captcha'
import { currentTrafficPeriod } from './domain/quota'
import { isLocalNetworkOrigin } from './lib/local-origin'
import { hashPassword, verifyPassword as verifyPasswordHash } from './lib/password'
import { createDbProxy, createPlatformProxy } from './platform/context'
import type { Database, Platform } from './platform/interface'
import { loadCaptchaConfig } from './usecases/site/captcha'
import { checkTeamLimit, getEffectiveSignupMode } from './usecases/site/licensing'

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

interface ProviderConfigs {
  oidc: OAuthProviderConfig[]
  builtin: Array<{ providerId: string; clientId: string; clientSecret: string }>
}

// One query loads every oauth_provider_* row. Configs are snapshotted at auth
// instance creation: better-auth resolves social providers eagerly during its
// context init, so per-request dynamic loading is not possible anyway. Admin
// changes take effect on isolate recycle (CF Workers) or restart (Node).
async function loadProviderConfigs(db: Database): Promise<ProviderConfigs> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(like(systemOptions.key, OAUTH_PROVIDER_KEY_PATTERN))

  const configs: ProviderConfigs = { oidc: [], builtin: [] }
  for (const row of rows) {
    const config = parseProviderConfig(row.value)
    if (!config?.enabled) continue
    if (config.type === 'oidc') {
      configs.oidc.push(config)
      continue
    }
    const providerId = row.key.slice(OAUTH_PROVIDER_KEY_PREFIX.length)
    if (config.type === 'builtin' && BUILTIN_PROVIDER_IDS.includes(providerId)) {
      configs.builtin.push({ providerId, clientId: config.clientId, clientSecret: config.clientSecret })
    }
  }
  return configs
}

// Maps stored captcha config to the better-auth captcha plugin options. Lives
// here because better-auth's CaptchaOptions type is delivery-framework-specific
// and may not leak into the framework-free usecases/ layer.
export function toBetterAuthCaptchaOptions(config: CaptchaConfig): CaptchaOptions {
  const base = {
    provider: config.provider,
    secretKey: config.secretKey,
    endpoints: [...CAPTCHA_AUTH_ENDPOINTS],
  }

  if (config.provider === 'google-recaptcha') {
    return config.minScore === undefined ? base : { ...base, minScore: config.minScore }
  }

  if (config.provider === 'hcaptcha' || config.provider === 'captchafox') {
    return { ...base, siteKey: config.siteKey }
  }

  return base
}

function dynamicCaptcha(db: Database): BetterAuthPlugin {
  return {
    id: 'dynamic-captcha',
    onRequest: async (request, ctx) => {
      // Only captcha-protected endpoints need the config — skip the DB read
      // for everything else (notably get-session, the hottest auth route).
      const path = new URL(request.url).pathname
      if (!CAPTCHA_AUTH_ENDPOINTS.some((endpoint) => path.endsWith(endpoint))) return
      const config = await loadCaptchaConfig({ systemOptions: createSystemOptionsRepo(db) })
      if (!config) return
      const plugin = captcha(toBetterAuthCaptchaOptions(config))
      return plugin.onRequest?.(request, ctx)
    },
  }
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

function buildResetPasswordEmailHtml(url: string): string {
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error(`Reset password URL has unsafe protocol: ${url}`)
  }
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">Reset your password</h2>
<p style="color:#555;line-height:1.5">Click the button below to choose a new password. This link expires in 1 hour.</p>
<a href="${url}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a>
<p style="color:#999;font-size:13px">If you didn't request a password reset, you can safely ignore this email.</p>
</div>`
}

export async function createAuth(
  initialSource: Database | Platform,
  secret: string,
  baseURL?: string,
  trustedOrigins?: string[],
) {
  const isPlatform = 'db' in initialSource
  const rawPlatform = isPlatform ? initialSource : null
  const rawDb = isPlatform ? initialSource.db : initialSource

  const platformProxy = rawPlatform ? createPlatformProxy(rawPlatform) : null
  const dbProxy = platformProxy ? platformProxy.db : createDbProxy(rawDb)

  const db = dbProxy
  // The email gateway needs a Platform for the Cloudflare EMAIL binding. On the
  // bare-Database path (tests, Node fallbacks) there is no platform, so wrap the
  // db proxy in a binding-free Platform — matching the previous behaviour where
  // a Database source had no CF binding available.
  const authPlatform: Platform = platformProxy ?? { db: dbProxy, getEnv: () => undefined, getBinding: () => undefined }
  const email = createEmailGateway(createSystemOptionsRepo(db))
  const providerConfigs = await loadProviderConfigs(rawDb)
  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    secret,
    baseURL,
    // Function form: better-auth merges the result with baseURL per request.
    // Loopback/LAN origins are trusted automatically so self-hosted users can
    // log in via 127.0.0.1 or a LAN IP without configuring TRUSTED_ORIGINS.
    trustedOrigins: (request?: Request) => {
      const origin = request?.headers.get('origin')
      const list = trustedOrigins ?? []
      return origin && isLocalNetworkOrigin(origin) ? [...list, origin] : list
    },
    advanced: {
      cookiePrefix: 'zp',
      // Explicitly enable the origin check (production default). Without this,
      // better-auth silently disables it under NODE_ENV=test, so tests would
      // never exercise the real CSRF/origin behavior.
      disableOriginCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      password: {
        hash: authHashPassword,
        verify: authVerifyPassword,
      },
      sendResetPassword: async ({ user, url }) => {
        if (!(await email.isConfigured(authPlatform))) return
        await email.send(authPlatform, {
          to: user.email,
          subject: 'Reset your password - ZPan',
          html: buildResetPasswordEmailHtml(url),
        })
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        if (!(await email.isConfigured(authPlatform))) return
        await email.send(authPlatform, {
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
    socialProviders: Object.fromEntries(
      providerConfigs.builtin.map((c) => [c.providerId, { clientId: c.clientId, clientSecret: c.clientSecret }]),
    ),
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
          if (!(await email.isConfigured(authPlatform))) return
          await email.send(authPlatform, {
            to: data.email,
            subject: `You've been invited to join ${data.organization.name} - ZPan`,
            html: buildInvitationEmailHtml(data),
          })
        },
        organizationHooks: {
          beforeCreateOrganization: async ({ user }) => {
            const {
              allowed,
              count: current_count,
              limit,
            } = await checkTeamLimit(
              { memberCount: createMemberCountRepo(db), licenseBinding: createLicenseBindingRepo(db) },
              user.id,
            )
            if (!allowed) {
              throw new APIError('PAYMENT_REQUIRED', {
                message:
                  'Team limit reached. Free includes one personal workspace plus one extra team. Upgrade to Pro for unlimited teams.',
                error: 'feature_not_available',
                feature: 'teams_unlimited',
                currentCount: current_count,
                limit,
              })
            }
          },
          afterCreateOrganization: async ({ organization }) => {
            const isTeam = !organization.slug.startsWith('personal-')
            await createOrgQuota(db, organization.id, new Date(), isTeam)
          },
          afterAcceptInvitation: async ({ member, user, organization }) => {
            await createActivityRepo(db).record({
              orgId: organization.id,
              userId: user.id,
              action: 'team_member_join',
              targetType: 'team',
              targetId: organization.id,
              targetName: organization.name,
              metadata: { role: member.role },
            })
            await createNotificationRepo(db).create({
              userId: user.id,
              type: 'team_join',
              title: `You joined ${organization.name}`,
              body: "You now have access to this team's space.",
              refType: 'team',
              refId: organization.id,
              metadata: JSON.stringify({ teamName: organization.name }),
            })
          },
          afterRemoveMember: async ({ member, organization }) => {
            // Better Auth does not expose the actor (initiator) in this hook;
            // member.userId is the removed user — used here as the attributed userId.
            await createActivityRepo(db).record({
              orgId: organization.id,
              userId: member.userId,
              action: 'team_member_remove',
              targetType: 'team',
              targetId: organization.id,
              targetName: organization.name,
              metadata: { removedUserId: member.userId },
            })
          },
          afterUpdateMemberRole: async ({ member, previousRole, organization }) => {
            // Better Auth does not expose the actor in this hook;
            // member.userId is the user whose role changed.
            await createActivityRepo(db).record({
              orgId: organization.id,
              userId: member.userId,
              action: 'team_member_role_update',
              targetType: 'team',
              targetId: organization.id,
              targetName: organization.name,
              metadata: { previousRole, newRole: member.role },
            })
          },
          afterUpdateOrganization: async ({ organization, user }) => {
            if (!organization?.id || !user?.id) return
            await createActivityRepo(db).record({
              orgId: organization.id,
              userId: user.id,
              action: 'team_settings_update',
              targetType: 'team',
              targetId: organization.id,
              targetName: organization.name ?? organization.id,
            })
          },
          afterDeleteOrganization: async ({ organization, user }) => {
            await createActivityRepo(db).record({
              orgId: organization.id,
              userId: user.id,
              action: 'team_delete',
              targetType: 'team',
              targetId: organization.id,
              targetName: organization.name,
            })
          },
        },
      }),
      username(),
      dynamicCaptcha(db),
      genericOAuth({
        config: providerConfigs.oidc.map((c) => ({
          providerId: c.providerId,
          clientId: c.clientId,
          clientSecret: c.clientSecret,
          discoveryUrl: c.discoveryUrl,
          scopes: c.scopes,
        })),
      }),
      bearer(),
      deviceAuthorization({
        schema: {},
        verificationUri: '/device',
        validateClient: async (clientId) => clientId === 'zpan-cli',
      }),
      apiKey([
        {
          configId: ApiKeyTemplate.IHOST,
          references: 'organization',
          rateLimit: {
            enabled: true,
            timeWindow: 60_000,
            maxRequests: 60,
          },
          permissions: {
            defaultPermissions: IHOST_API_KEY_PERMISSIONS,
          },
        },
        {
          configId: ApiKeyTemplate.WEBDAV,
          references: 'user',
          rateLimit: {
            enabled: true,
            timeWindow: 60_000,
            maxRequests: 120,
          },
          permissions: {
            defaultPermissions: WEBDAV_API_KEY_PERMISSIONS,
          },
        },
        {
          configId: ApiKeyTemplate.REMOTE_DOWNLOAD,
          references: 'organization',
          rateLimit: {
            enabled: true,
            timeWindow: 60_000,
            maxRequests: 120,
          },
          permissions: {
            defaultPermissions: REMOTE_DOWNLOAD_API_KEY_PERMISSIONS,
          },
        },
      ]),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const firstUser = await isFirstUser(db)

            // Registration gate: skip for the very first user so bootstrap works
            if (!firstUser) {
              const mode = await getEffectiveSignupMode({
                systemOptions: createSystemOptionsRepo(db),
                licenseBinding: createLicenseBindingRepo(db),
              })
              const email = String(user.email ?? '')
              const siteInvitationToken = (context?.body as { siteInvitationToken?: string })?.siteInvitationToken
              if (mode === SignupMode.CLOSED) {
                if (!siteInvitationToken) {
                  throw new Error('An invitation is required to register')
                }
                const validation = await createSiteInvitationRepo(db).validateSiteInvitation(siteInvitationToken, email)
                if (!validation.valid) {
                  throw new Error(validation.error ?? 'Invalid invitation')
                }
              }
              if (mode === SignupMode.INVITE_ONLY) {
                const inviteCode = (context?.body as { inviteCode?: string })?.inviteCode
                if (!inviteCode) {
                  throw new Error('An invite code is required to register')
                }
                const validation = await createInviteRepo(db).validate(inviteCode)
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
            const mode = await getEffectiveSignupMode({
              systemOptions: createSystemOptionsRepo(db),
              licenseBinding: createLicenseBindingRepo(db),
            })
            if (mode === SignupMode.INVITE_ONLY) {
              const inviteCode = (context?.body as { inviteCode?: string })?.inviteCode
              if (inviteCode) {
                await createInviteRepo(db).redeem(inviteCode, user.id)
              }
            }

            const siteInvitationToken = (context?.body as { siteInvitationToken?: string })?.siteInvitationToken
            if (siteInvitationToken) {
              const result = await createSiteInvitationRepo(db).acceptSiteInvitation(
                siteInvitationToken,
                user.email,
                user.id,
              )
              if (result !== 'ok' && result !== 'accepted') {
                throw new Error(`Failed to redeem site invitation: ${result}`)
              }
            }

            // Create personal org as part of registration.
            // This hook is deferred until after the transaction commits, so
            // when autoSignIn is enabled the org is actually created by
            // session.create.before (which runs earlier, inside the txn).
            // The idempotent check ensures no duplicate is created.
            const existing = await createOrgRepo(db).findPersonalOrg(user.id)
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
            let orgId = await createOrgRepo(db).findPersonalOrg(session.userId)

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

  // betterAuth() starts its lazy $context init synchronously, inside whichever
  // request constructs the instance. Resolve it here so a cached instance never
  // carries a pending promise tied to its creating request — on Cloudflare
  // Workers such a promise never settles when awaited from a later request,
  // which would hang every auth call in the isolate.
  await auth.$context
  return auth
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
  const quotaValues = await createOrgQuotaValues(db, orgId, now)
  const entitlementValues = await createFreePlanEntitlementValues(db, orgId, now, false)

  await executeWriteTransaction(db, [
    db.insert(authSchema.organization).values({
      id: orgId,
      name: orgName,
      slug: `personal-${user.id}`,
      metadata: JSON.stringify({ type: 'personal' }),
      createdAt: now,
    }),
    db.insert(authSchema.member).values({
      id: nanoid(),
      organizationId: orgId,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    }),
    db.insert(orgQuotas).values(quotaValues),
    ...entitlementValues.map((value) => db.insert(orgQuotaEntitlements).values(value)),
  ])

  return orgId
}

async function createOrgQuotaValues(_db: Database, orgId: string, now: Date): Promise<typeof orgQuotas.$inferInsert> {
  return {
    id: nanoid(),
    orgId,
    quota: 0,
    used: 0,
    trafficQuota: 0,
    trafficUsed: 0,
    trafficPeriod: currentTrafficPeriod(now),
  }
}

async function createOrgQuota(db: Database, orgId: string, now: Date, isTeam = false): Promise<void> {
  await executeWriteTransaction(db, [
    db.insert(orgQuotas).values(await createOrgQuotaValues(db, orgId, now)),
    ...(await createFreePlanEntitlementValues(db, orgId, now, isTeam)).map((value) =>
      db.insert(orgQuotaEntitlements).values(value),
    ),
  ])
}

async function createFreePlanEntitlementValues(
  db: Database,
  orgId: string,
  now: Date,
  isTeam: boolean,
): Promise<(typeof orgQuotaEntitlements.$inferInsert)[]> {
  const storageDefault = isTeam ? await getDefaultTeamQuota(db) : null
  const defaultQuota = storageDefault?.bytes ?? (await getDefaultOrgQuota(db))
  const storageSettingKey = storageDefault?.settingKey ?? 'default_org_quota'
  const defaultTrafficQuota = await getDefaultOrgTrafficQuota(db)

  return [
    freePlanEntitlementValue(orgId, 'storage', defaultQuota, now, storageSettingKey),
    freePlanEntitlementValue(orgId, 'traffic', defaultTrafficQuota, now, 'default_org_monthly_traffic_quota'),
  ]
}

function freePlanEntitlementValue(
  orgId: string,
  resourceType: 'storage' | 'traffic',
  bytes: number,
  now: Date,
  settingKey: string,
): typeof orgQuotaEntitlements.$inferInsert {
  return {
    id: nanoid(),
    orgId,
    resourceType,
    entitlementType: 'plan',
    source: 'free_plan',
    sourceId: `free_plan:${orgId}`,
    bytes,
    startsAt: now,
    expiresAt: null,
    status: 'active',
    metadata: JSON.stringify({
      packageName: 'Free',
      packageId: null,
      source: 'free_plan',
      settingKey,
    }),
    createdAt: now,
    updatedAt: now,
  }
}

// Default storage quota for newly created team orgs. Returns null when the
// option is unset so callers fall back to the personal-org default.
async function getDefaultTeamQuota(db: Database): Promise<{ bytes: number; settingKey: string } | null> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'default_team_quota'))
  const raw = rows[0]?.value
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return { bytes: n, settingKey: 'default_team_quota' }
}

async function getDefaultOrgQuota(db: Database): Promise<number> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'default_org_quota'))
  const raw = rows[0]?.value
  if (raw == null) return DEFAULT_ORG_QUOTA
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ORG_QUOTA
}

async function getDefaultOrgTrafficQuota(db: Database): Promise<number> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'default_org_monthly_traffic_quota'))
  const raw = rows[0]?.value
  if (raw == null) return DEFAULT_ORG_TRAFFIC_QUOTA
  const value = raw.trim()
  const n = Number(value)
  if (value === '' || !Number.isInteger(n) || n < 0)
    throw new Error('default_org_monthly_traffic_quota must be a non-negative integer')
  return n
}
