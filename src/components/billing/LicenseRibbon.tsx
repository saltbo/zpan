import type { LicenseEdition } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { useEntitlement } from '@/hooks/useEntitlement'

const GITHUB_URL = 'https://github.com/saltbo/zpan'
const CLOUD_DASHBOARD_FALLBACK = 'https://cloud.zpan.space/dashboard'

function editionKey(bound: boolean, edition: LicenseEdition | null): 'community' | 'pro' | 'business' {
  if (!bound) return 'community'
  return edition === 'business' ? 'business' : 'pro'
}

const RIBBON_STYLES: Record<'community' | 'pro' | 'business', string> = {
  community: '#64748B',
  pro: '#1A73E8',
  business: '#F59E0B',
}

export function LicenseRibbon() {
  const { t } = useTranslation()
  const { bound, edition, cloudDashboardUrl, isLoading } = useEntitlement()

  if (isLoading) return null

  const key = editionKey(bound, edition)
  const label = t(`admin.licenseRibbon.${key}`)
  const color = RIBBON_STYLES[key]

  let href: string
  if (key === 'business') {
    href = cloudDashboardUrl ?? CLOUD_DASHBOARD_FALLBACK
  } else {
    href = GITHUB_URL
  }

  return (
    <div data-slot="license-ribbon" className="pointer-events-none fixed right-0 top-0 z-50 h-24 w-24 overflow-hidden">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('admin.licenseRibbon.ariaLabel', { edition: label })}
        className="pointer-events-auto absolute -right-6 top-3 w-24 rotate-45 py-1 text-center text-xs font-semibold text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {label}
      </a>
    </div>
  )
}
