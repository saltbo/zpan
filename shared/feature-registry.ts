import { FREE_EXTRA_TEAM_LIMIT, FREE_STORAGE_LIMIT } from './constants'

// ---------------------------------------------------------------------------
// Cell values for the comparison table
// ---------------------------------------------------------------------------

/** A cell in the comparison table: boolean (✅/❌) or a structured i18n label. */
export type CellValue = boolean | { i18nKey: string; params?: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Feature categories
// ---------------------------------------------------------------------------

export const FEATURE_CATEGORIES = ['core', 'pro'] as const

export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number]

/** i18n key for each category header. */
export const CATEGORY_I18N: Record<FeatureCategory, string> = {
  core: 'features.category.core',
  pro: 'features.category.pro',
}

// ---------------------------------------------------------------------------
// Feature definition
// ---------------------------------------------------------------------------

export interface FeatureDefinition {
  /** i18n key for the feature name shown in the comparison table. */
  i18nKey: string
  /** Which section this feature belongs to. */
  category: FeatureCategory
  /** What Community plan gets — true (included), false (not included), or structured value. */
  community: CellValue
  /** What Pro plan gets — true (included), false (not included), or structured value. */
  pro: CellValue
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
  // ── Core Features ───────────────────────────────────────────────────
  {
    i18nKey: 'features.coreFileManagement',
    category: 'core',
    community: true,
    pro: true,
  },
  {
    i18nKey: 'features.shareLinks',
    category: 'core',
    community: true,
    pro: true,
  },
  {
    i18nKey: 'features.imageHosting',
    category: 'core',
    community: true,
    pro: true,
  },
  {
    i18nKey: 'features.socialLoginOidc',
    category: 'core',
    community: true,
    pro: true,
  },
  {
    i18nKey: 'features.inviteCodes',
    category: 'core',
    community: true,
    pro: true,
  },

  // ── Pro Features ────────────────────────────────────────────────────
  {
    i18nKey: 'features.whiteLabel',
    category: 'pro',
    community: false,
    pro: true,
    gateKey: 'white_label',
  },
  {
    i18nKey: 'features.openRegistration',
    category: 'pro',
    community: false,
    pro: true,
    gateKey: 'open_registration',
  },
  {
    i18nKey: 'features.teamWorkspaces',
    category: 'pro',
    community: { i18nKey: 'features.teamWorkspaces.limit', params: { count: FREE_EXTRA_TEAM_LIMIT } },
    pro: { i18nKey: 'features.teamWorkspaces.unlimited' },
    gateKey: 'teams_unlimited',
  },
  {
    i18nKey: 'features.storageBackends',
    category: 'pro',
    community: { i18nKey: 'features.storageBackends.limit', params: { count: FREE_STORAGE_LIMIT } },
    pro: { i18nKey: 'features.storageBackends.unlimited' },
    gateKey: 'storages_unlimited',
  },
  {
    i18nKey: 'features.multiIdpSso',
    category: 'pro',
    community: false,
    pro: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.ldapScim',
    category: 'pro',
    community: false,
    pro: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.auditLog',
    category: 'pro',
    community: false,
    pro: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.webhooks',
    category: 'pro',
    community: false,
    pro: true,
    comingSoon: true,
  },
  {
    i18nKey: 'features.analytics',
    category: 'pro',
    community: false,
    pro: true,
    comingSoon: true,
  },
] as const satisfies readonly FeatureDefinition[]

// ---------------------------------------------------------------------------
// Derived types — ProFeature union from gateKey literals
// ---------------------------------------------------------------------------

type GatedFeature = Extract<(typeof FEATURE_REGISTRY)[number], { gateKey: string }>

/**
 * Union of all active entitlement gate keys.
 * Automatically stays in sync with the registry.
 */
export type ProFeature = GatedFeature['gateKey']

/** Runtime array of all active gate keys (for validation / iteration). */
export const PRO_GATE_KEYS = FEATURE_REGISTRY.filter(
  (f): f is (typeof FEATURE_REGISTRY)[number] & { gateKey: string } => 'gateKey' in f && f.gateKey != null,
).map((f) => f.gateKey as ProFeature)
