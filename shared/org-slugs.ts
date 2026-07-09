import { customAlphabet } from 'nanoid'

export const LEGACY_PERSONAL_ORG_SLUG_PREFIX = 'personal-'
export const USER_ORG_SLUG_PREFIX = 'u'
export const TEAM_ORG_SLUG_PREFIX = 't'
export const ORG_SLUG_RANDOM_LENGTH = 16

const randomSlugSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', ORG_SLUG_RANDOM_LENGTH)

export function generateUserOrgSlug(): string {
  return `${USER_ORG_SLUG_PREFIX}${randomSlugSuffix()}`
}

export function generateTeamOrgSlug(): string {
  return `${TEAM_ORG_SLUG_PREFIX}${randomSlugSuffix()}`
}

export function isPersonalOrgLike(org: { slug?: string | null; metadata?: unknown }): boolean {
  return org.slug?.startsWith(LEGACY_PERSONAL_ORG_SLUG_PREFIX) === true || orgMetadataType(org.metadata) === 'personal'
}

export function isTeamOrgLike(org: { slug?: string | null; metadata?: unknown }): boolean {
  return !isPersonalOrgLike(org)
}

function orgMetadataType(metadata: unknown): string | null {
  if (!metadata) return null
  if (typeof metadata === 'object') {
    const type = (metadata as { type?: unknown }).type
    return typeof type === 'string' ? type : null
  }
  if (typeof metadata !== 'string') return null
  try {
    const parsed = JSON.parse(metadata) as { type?: unknown }
    return typeof parsed.type === 'string' ? parsed.type : null
  } catch {
    return null
  }
}
