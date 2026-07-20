// The auth-providers resource usecase. Owns every business decision behind the
// admin auth-provider API and configz projection — provider-id validation, the
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
  OAUTH_PROVIDER_KEY_PREFIX,
  type OAuthProviderConfig,
  OAuthProviderMeta,
  type OAuthProviderType,
  parseProviderConfig,
} from '@shared/oauth-providers'
import type { SiteConfig } from '@shared/schemas'
import type { AuthProvider } from '@shared/types'
import { hasFeature } from '../../domain/licensing'
import { type AppError, badRequest, featureBlocked, type LicenseBindingRepo, type SystemOptionsRepo } from '../ports'
import { loadBindingState } from './licensing'

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

function callbackPath(config: OAuthProviderConfig): string {
  return config.type === 'oidc'
    ? `/api/auth/oauth2/callback/${config.providerId}`
    : `/api/auth/callback/${config.providerId}`
}

export function providerCallbackUri(config: OAuthProviderConfig, authOrigin: string): string {
  return `${authOrigin.replace(/\/$/, '')}${callbackPath(config)}`
}

// Map a stored config to the one monomorphic AuthProvider shape every caller sees.
// Role changes values only: admin gets a masked clientSecret, front-of-house gets null.
// name/icon come from the static OAuthProviderMeta registry (providerId fallback);
// clientId/discoveryUrl/scopes are not secrets, so they are exposed to everyone.
function toAuthProvider(config: OAuthProviderConfig, authOrigin: string): AuthProvider {
  const meta = OAuthProviderMeta[config.providerId]
  return {
    providerId: config.providerId,
    type: config.type,
    enabled: config.enabled,
    name: meta?.name ?? config.providerId,
    icon: meta?.icon ?? config.providerId,
    clientId: config.clientId,
    discoveryUrl: config.discoveryUrl ?? null,
    scopes: config.scopes ?? null,
    callbackUri: providerCallbackUri(config, authOrigin),
    clientSecret: maskSecret(config.clientSecret),
  }
}

// `invalid_id` / `unknown_builtin` / `missing_discovery` are 400 validations;
// `feature_blocked` is the 402 Community social-login gate.
export type UpsertProviderInput = {
  type: OAuthProviderType
  clientId: string
  clientSecret: string
  enabled: boolean
  discoveryUrl?: string
  scopes?: string[]
}

export type UpsertProviderOutcome = { ok: true; config: AuthProvider } | { ok: false; error: AppError }

export type DeleteProviderOutcome = { ok: true } | { ok: false; error: AppError }

const INVALID_PROVIDER_ID_MESSAGE = 'Provider ID must contain only lowercase letters, numbers, and hyphens'

export async function listAuthProviders(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
  { authOrigin }: { authOrigin: string },
): Promise<{ items: AuthProvider[] }> {
  const rows = await deps.systemOptions.listByPrefix(OAUTH_PROVIDER_KEY_PREFIX)
  const items = rows
    .map((r) => parseProviderConfig(r.value))
    .filter((config) => config !== null)
    .map((config) => toAuthProvider(config, authOrigin))
  return { items }
}

export async function listPublicAuthProviders(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
): Promise<SiteConfig['auth']['providers']> {
  const rows = await deps.systemOptions.listByPrefix(OAUTH_PROVIDER_KEY_PREFIX)
  return rows
    .map((row) => parseProviderConfig(row.value))
    .filter((config): config is OAuthProviderConfig => config?.enabled === true)
    .map((config) => {
      const meta = OAuthProviderMeta[config.providerId]
      return {
        id: config.providerId,
        type: config.type,
        name: meta?.name ?? config.providerId,
        icon: meta?.icon ?? config.providerId,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

export async function upsertAuthProvider(
  deps: AuthProviderDeps,
  providerId: string,
  input: UpsertProviderInput,
  { authOrigin }: { authOrigin: string },
): Promise<UpsertProviderOutcome> {
  if (!isValidProviderId(providerId)) return { ok: false, error: badRequest(INVALID_PROVIDER_ID_MESSAGE) }
  if (input.type === 'builtin' && !BUILTIN_PROVIDER_IDS.includes(providerId)) {
    return { ok: false, error: badRequest(`Unknown builtin provider: ${providerId}`) }
  }
  if (input.type === 'oidc' && !input.discoveryUrl)
    return { ok: false, error: badRequest('discoveryUrl is required for OIDC providers') }

  const config: OAuthProviderConfig = { providerId, ...input }
  const key = optionKey(providerId)
  const value = JSON.stringify(config)

  const existing = await deps.systemOptions.get(key)
  if (existing) {
    await deps.systemOptions.set(key, value)
  } else {
    // The free-plan count limit only gates *new* providers, not updates to an
    // existing one.
    const [configured, state] = await Promise.all([
      deps.systemOptions.listByPrefix(OAUTH_PROVIDER_KEY_PREFIX),
      loadBindingState(deps),
    ])
    if (!hasFeature('social_login_unlimited', state) && configured.length >= FREE_SOCIAL_LOGIN_LIMIT) {
      return {
        ok: false,
        error: featureBlocked('Feature not available', {
          metadata: {
            feature: 'social_login_unlimited',
            currentCount: String(configured.length),
            limit: String(FREE_SOCIAL_LOGIN_LIMIT),
            upgradeUrl: '/settings/billing',
          },
        }),
      }
    }
    await deps.systemOptions.set(key, value)
  }

  return { ok: true, config: toAuthProvider(config, authOrigin) }
}

export async function deleteAuthProvider(
  deps: Pick<AuthProviderDeps, 'systemOptions'>,
  providerId: string,
): Promise<DeleteProviderOutcome> {
  if (!isValidProviderId(providerId)) return { ok: false, error: badRequest(INVALID_PROVIDER_ID_MESSAGE) }
  await deps.systemOptions.delete(optionKey(providerId))
  return { ok: true }
}
