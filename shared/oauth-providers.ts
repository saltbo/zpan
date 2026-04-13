/**
 * Static display metadata for all built-in better-auth social providers.
 * Used by the frontend to render login buttons with correct names and icons.
 */
export const OAuthProviderMeta: Record<string, { name: string; icon: string } | undefined> = {
  apple: { name: 'Apple', icon: 'apple' },
  atlassian: { name: 'Atlassian', icon: 'atlassian' },
  cognito: { name: 'AWS Cognito', icon: 'cognito' },
  discord: { name: 'Discord', icon: 'discord' },
  dropbox: { name: 'Dropbox', icon: 'dropbox' },
  facebook: { name: 'Facebook', icon: 'facebook' },
  figma: { name: 'Figma', icon: 'figma' },
  github: { name: 'GitHub', icon: 'github' },
  gitlab: { name: 'GitLab', icon: 'gitlab' },
  google: { name: 'Google', icon: 'google' },
  huggingface: { name: 'Hugging Face', icon: 'huggingface' },
  kakao: { name: 'Kakao', icon: 'kakao' },
  kick: { name: 'Kick', icon: 'kick' },
  line: { name: 'LINE', icon: 'line' },
  linear: { name: 'Linear', icon: 'linear' },
  linkedin: { name: 'LinkedIn', icon: 'linkedin' },
  microsoft: { name: 'Microsoft', icon: 'microsoft' },
  naver: { name: 'Naver', icon: 'naver' },
  notion: { name: 'Notion', icon: 'notion' },
  paybin: { name: 'Paybin', icon: 'paybin' },
  paypal: { name: 'PayPal', icon: 'paypal' },
  polar: { name: 'Polar', icon: 'polar' },
  railway: { name: 'Railway', icon: 'railway' },
  reddit: { name: 'Reddit', icon: 'reddit' },
  roblox: { name: 'Roblox', icon: 'roblox' },
  salesforce: { name: 'Salesforce', icon: 'salesforce' },
  slack: { name: 'Slack', icon: 'slack' },
  spotify: { name: 'Spotify', icon: 'spotify' },
  tiktok: { name: 'TikTok', icon: 'tiktok' },
  twitch: { name: 'Twitch', icon: 'twitch' },
  twitter: { name: 'Twitter / X', icon: 'twitter' },
  vercel: { name: 'Vercel', icon: 'vercel' },
  vk: { name: 'VK', icon: 'vk' },
  wechat: { name: 'WeChat', icon: 'wechat' },
  zoom: { name: 'Zoom', icon: 'zoom' },
}

/** All built-in provider IDs supported by better-auth */
export const BUILTIN_PROVIDER_IDS = Object.keys(OAuthProviderMeta) as readonly string[]

/** Key prefix for OAuth provider configs stored in system_options */
export const OAUTH_PROVIDER_KEY_PREFIX = 'oauth_provider_'

/** LIKE pattern for querying all OAuth provider configs */
export const OAUTH_PROVIDER_KEY_PATTERN = `${OAUTH_PROVIDER_KEY_PREFIX}%`

/** Regex for valid custom OIDC provider IDs */
const PROVIDER_ID_RE = /^[a-z0-9-]+$/

export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id)
}

export function parseProviderConfig(value: string): OAuthProviderConfig | null {
  try {
    return JSON.parse(value) as OAuthProviderConfig
  } catch {
    return null
  }
}

export type OAuthProviderType = 'builtin' | 'oidc'

export interface OAuthProviderConfig {
  providerId: string
  type: OAuthProviderType
  clientId: string
  clientSecret: string
  enabled: boolean
  /** Only for type: 'oidc' */
  discoveryUrl?: string
  /** Only for type: 'oidc' */
  scopes?: string[]
}
