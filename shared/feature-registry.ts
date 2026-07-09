import { FREE_DOWNLOADER_LIMIT, FREE_EXTRA_TEAM_LIMIT, FREE_SOCIAL_LOGIN_LIMIT, FREE_STORAGE_LIMIT } from './constants'

// ---------------------------------------------------------------------------
// Cell values for the comparison table
// ---------------------------------------------------------------------------

/** A cell in the comparison table: boolean (✅/❌) or a structured i18n label. */
export type CellValue = boolean | { i18nKey: string; params?: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Feature categories
// ---------------------------------------------------------------------------

// Functional grouping for the comparison table — NOT a tier. Which edition a
// feature is available in is expressed by its community/pro/business cells.
export const FEATURE_CATEGORIES = ['core', 'advanced'] as const

export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number]

/** i18n key for each category header. */
export const CATEGORY_I18N: Record<FeatureCategory, string> = {
  core: 'features.category.core',
  advanced: 'features.category.advanced',
}

// ---------------------------------------------------------------------------
// Feature definition
// ---------------------------------------------------------------------------

export interface FeatureDefinition {
  /** i18n key for the feature name shown in the comparison table. */
  i18nKey: string
  /** Functional group this feature belongs to (core vs advanced) — not a tier. */
  category: FeatureCategory
  /** What Community plan gets — true (included), false (not included), or structured value. */
  community: CellValue
  /** What Pro plan gets — true (included), false (not included), or structured value. */
  pro: CellValue
  /** What Business plan gets — true (included), false (not included), or structured value. */
  business: CellValue
  /**
   * If present, this feature is a real entitlement gate enforced at runtime.
   * The value must match a key in the PRO_GATE_KEYS tuple.
   */
  gateKey?: string
  /** Feature is planned but not yet implemented; shown with a "Coming Soon" badge. */
  comingSoon?: boolean
}

// ---------------------------------------------------------------------------
// Registry — single source of truth
// ---------------------------------------------------------------------------

export const FEATURE_REGISTRY = [
  // ── Core capabilities (available in every edition, some with free limits) ──
  {
    i18nKey: 'features.coreFileManagement',
    category: 'core',
    community: true,
    pro: true,
    business: true,
  },
  {
    i18nKey: 'features.shareLinks',
    category: 'core',
    community: true,
    pro: true,
    business: true,
  },
  {
    i18nKey: 'features.imageHosting',
    category: 'core',
    community: true,
    pro: true,
    business: true,
  },
  {
    i18nKey: 'features.socialLoginOidc',
    category: 'core',
    community: { i18nKey: 'features.socialLoginOidc.limit', params: { count: FREE_SOCIAL_LOGIN_LIMIT } },
    pro: { i18nKey: 'features.socialLoginOidc.unlimited' },
    business: { i18nKey: 'features.socialLoginOidc.unlimited' },
    gateKey: 'social_login_unlimited',
  },
  {
    i18nKey: 'features.inviteCodes',
    category: 'core',
    community: true,
    pro: true,
    business: true,
  },

  // ── Advanced capabilities (edition availability shown per-cell) ──────
  {
    i18nKey: 'features.whiteLabel',
    category: 'advanced',
    community: false,
    pro: true,
    business: true,
    gateKey: 'white_label',
  },
  {
    i18nKey: 'features.openRegistration',
    category: 'advanced',
    community: false,
    pro: true,
    business: true,
    gateKey: 'open_registration',
  },
  {
    i18nKey: 'features.teamWorkspaces',
    category: 'advanced',
    community: { i18nKey: 'features.teamWorkspaces.limit', params: { count: FREE_EXTRA_TEAM_LIMIT } },
    pro: { i18nKey: 'features.teamWorkspaces.unlimited' },
    business: { i18nKey: 'features.teamWorkspaces.unlimited' },
    gateKey: 'teams_unlimited',
  },
  {
    i18nKey: 'features.storageBackends',
    category: 'advanced',
    community: { i18nKey: 'features.storageBackends.limit', params: { count: FREE_STORAGE_LIMIT } },
    pro: { i18nKey: 'features.storageBackends.unlimited' },
    business: { i18nKey: 'features.storageBackends.unlimited' },
    gateKey: 'storages_unlimited',
  },
  {
    i18nKey: 'features.downloaders',
    category: 'advanced',
    community: { i18nKey: 'features.downloaders.limit', params: { count: FREE_DOWNLOADER_LIMIT } },
    pro: { i18nKey: 'features.downloaders.unlimited' },
    business: { i18nKey: 'features.downloaders.unlimited' },
    gateKey: 'downloaders_unlimited',
  },
  {
    i18nKey: 'features.cloudStore',
    category: 'advanced',
    community: false,
    pro: false,
    business: true,
    gateKey: 'quota_store',
  },
  {
    i18nKey: 'features.auditLog',
    category: 'advanced',
    community: false,
    pro: true,
    business: true,
    gateKey: 'audit_log',
  },
  {
    i18nKey: 'features.webhooks',
    category: 'advanced',
    community: false,
    pro: true,
    business: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.siteAnnouncements',
    category: 'advanced',
    community: false,
    pro: false,
    business: true,
    gateKey: 'site_announcements',
  },
  {
    i18nKey: 'features.multiIdpSso',
    category: 'advanced',
    community: false,
    pro: false,
    business: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.ldapScim',
    category: 'advanced',
    community: false,
    pro: false,
    business: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.analytics',
    category: 'advanced',
    community: false,
    pro: true,
    business: true,
    gateKey: 'analytics',
  },
] as const satisfies readonly FeatureDefinition[]

// ---------------------------------------------------------------------------
// Derived types — feature gate union from gateKey literals
// ---------------------------------------------------------------------------

type GatedFeature = Extract<(typeof FEATURE_REGISTRY)[number], { gateKey: string }>

/**
 * Union of all active entitlement gate keys.
 * Automatically stays in sync with the registry.
 */
export type LicenseFeature = GatedFeature['gateKey']

export type ProFeature = LicenseFeature

/** Runtime array of all active gate keys (for validation / iteration). */
export const PRO_GATE_KEYS = FEATURE_REGISTRY.filter(
  (f): f is (typeof FEATURE_REGISTRY)[number] & { gateKey: string } => 'gateKey' in f && f.gateKey != null,
).map((f) => f.gateKey as ProFeature)
