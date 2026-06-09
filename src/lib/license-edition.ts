import type { LicenseEdition } from '@shared/types'

export type EditionKey = 'community' | 'pro' | 'business'

// Solid badge colors mirroring the ZPan Cloud license certificate palette:
// Pro = gold, Business = indigo ("bluish but not blue"). Free = neutral gray.
export const EDITION_COLORS: Record<EditionKey, string> = {
  community: '#64748B',
  pro: '#D8AB44',
  business: '#5B73E8',
}

export function editionKey(bound: boolean, edition: LicenseEdition | null): EditionKey {
  if (!bound) return 'community'
  return edition === 'business' ? 'business' : 'pro'
}
