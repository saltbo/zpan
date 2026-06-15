// The auth-providers resource usecase. Owns every business decision behind the
// /api/admin/auth-providers (full CRUD, secrets masked) and /api/site/auth-providers
// (public, enabled-only, no secrets) routes — provider-id validation, the
// builtin/OIDC shape rules, and the Community social-login-count gate — so the
// http handlers only validate the request body, call these functions, and
// serialize the result.
//
// OAuth provider configs are stored as JSON values in system_options under the
// `oauth_provider_<id>` key; all reads/writes go through the SystemOptionsRepo.

import { FREE_SOCIAL_LOGIN_LIMIT } from '@shared/constants'
import {
  BUILTIN_PROVIDER_IDS,
  isValidProviderId,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  type OAuthProviderConfig,
  OAuthProviderMeta,
  type OAuthProviderType,
  parseProviderConfig,
} from '@shared/oauth-providers'
import { hasFeature } from '../domain/licensing'
import { loadBindingState } from './licensing'
import type { LicenseBindingRepo, SystemOptionsRepo } from './ports'

export type AuthProviderDeps = {
  systemOptions: SystemOptionsRepo
  licenseBinding: LicenseBindingRepo
}

function optionKey(providerId: string): string {
  return `${OAUTH_PROVIDER_KEY_PREFIX}${providerId}`
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '****'
  return `${'*'.repeat(secret.length - 4)}${secret.slice(-4)}`
}

// A stored config with its clientSecret masked — the shape the admin routes
// return (list items and the upsert response body).
export type MaskedProviderConfig = Omit<OAuthProviderConfig, 'clientSecret'> & { clientSecret: string }

function maskConfig(config: OAuthProviderConfig): MaskedProviderConfig {
  return { ...config, clientSecret: maskSecret(config.clientSecret) }
}

// A login-page button: just the public-safe display fields, never secrets.
export type PublicProvider = {
  providerId: string
  type: OAuthProviderType
  name: string
  icon: string
}

// Why an upsert was rejected. `invalid_id` / `unknown_builtin` / `missing_discovery`
// are 400 validations; `feature_blocked` is the 402 Community social-login gate.
export type UpsertProviderInput = {
  type: OAuthProviderType
  clientId: string
  clientSecret: string
  enabled: boolean
  discoveryUrl?: string
  scopes?: string[]
}

export type SocialLoginFeatureBlock = {
  feature: 'social_login_unlimited'
  currentCount: number
  limit: number
}

export type UpsertProviderOutcome =
  | { ok: true; config: MaskedProviderConfig }
  | { ok: false; reason: 'invalid_id' }
  | { ok: false; reason: 'unknown_builtin' }
  | { ok: false; reason: 'missing_discovery' }
  | { ok: false; reason: 'feature_blocked'; block: SocialLoginFeatureBlock }

export type DeleteProviderOutcome = { ok: true } | { ok: false; reason: 'invalid_id' }

// Public: enabled providers only, no secrets (for login page buttons).
export async function listPublicAuthProviders(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
): Promise<{ items: PublicProvider[] }> {
  const rows = await deps.systemOptions.listByKeyLike(OAUTH_PROVIDER_KEY_PATTERN)
  const items = rows
    .map((r) => {
      const config = parseProviderConfig(r.value)
      if (!config?.enabled) return null
      const meta = OAuthProviderMeta[config.providerId]
      return {
        providerId: config.providerId,
        type: config.type,
        name: meta?.name ?? config.providerId,
        icon: meta?.icon ?? config.providerId,
      }
    })
    .filter((item) => item !== null)
  return { items }
}

// Admin: full CRUD with secrets masked — every stored config, enabled or not.
export async function listAuthProviders(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
): Promise<{ items: MaskedProviderConfig[] }> {
  const rows = await deps.systemOptions.listByKeyLike(OAUTH_PROVIDER_KEY_PATTERN)
  const items = rows
    .map((r) => {
      const config = parseProviderConfig(r.value)
      if (!config) return null
      return maskConfig(config)
    })
    .filter((item) => item !== null)
  return { items }
}

export async function upsertAuthProvider(
  deps: AuthProviderDeps,
  providerId: string,
  input: UpsertProviderInput,
): Promise<UpsertProviderOutcome> {
  if (!isValidProviderId(providerId)) return { ok: false, reason: 'invalid_id' }
  if (input.type === 'builtin' && !BUILTIN_PROVIDER_IDS.includes(providerId)) {
    return { ok: false, reason: 'unknown_builtin' }
  }
  if (input.type === 'oidc' && !input.discoveryUrl) return { ok: false, reason: 'missing_discovery' }

  const config: OAuthProviderConfig = { providerId, ...input }
  const key = optionKey(providerId)
  const value = JSON.stringify(config)

  const existing = await deps.systemOptions.get(key)
  if (existing) {
    await deps.systemOptions.set(key, value, false)
  } else {
    // The free-plan count limit only gates *new* providers, not updates to an
    // existing one.
    const [configured, state] = await Promise.all([
      deps.systemOptions.listByKeyLike(OAUTH_PROVIDER_KEY_PATTERN),
      loadBindingState(deps),
    ])
    if (!hasFeature('social_login_unlimited', state) && configured.length >= FREE_SOCIAL_LOGIN_LIMIT) {
      return {
        ok: false,
        reason: 'feature_blocked',
        block: {
          feature: 'social_login_unlimited',
          currentCount: configured.length,
          limit: FREE_SOCIAL_LOGIN_LIMIT,
        },
      }
    }
    await deps.systemOptions.set(key, value, false)
  }

  return { ok: true, config: maskConfig(config) }
}

export async function deleteAuthProvider(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
  providerId: string,
): Promise<DeleteProviderOutcome> {
  if (!isValidProviderId(providerId)) return { ok: false, reason: 'invalid_id' }
  await deps.systemOptions.delete(optionKey(providerId))
  return { ok: true }
}
