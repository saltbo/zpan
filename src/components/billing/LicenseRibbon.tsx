import { useTranslation } from 'react-i18next'
import { useEntitlement } from '@/hooks/useEntitlement'

const GITHUB_URL = 'https://github.com/saltbo/zpan'
const CLOUD_DASHBOARD_FALLBACK = 'https://cloud.zpan.space/dashboard'

interface RibbonConfig {
  labelKey: string
  color: string
  href: string
}

function resolveRibbon(bound: boolean, edition: string | null, cloudDashboardUrl: string | undefined): RibbonConfig {
  if (!bound || !edition) {
    return {
      labelKey: 'admin.ribbon.community',
      color: '#64748B',
      href: GITHUB_URL,
    }
  }
  if (edition === 'business') {
    return {
      labelKey: 'admin.ribbon.business',
      color: '#F59E0B',
      // Task spec: use cloud_dashboard_url with fallback to the canonical dashboard URL
      href: cloudDashboardUrl ?? CLOUD_DASHBOARD_FALLBACK,
    }
  }
  // Pro — and any future edition that is not 'business'
  // Both Pro and Community link to GitHub per product spec
  return {
    labelKey: 'admin.ribbon.pro',
    color: '#1A73E8',
    href: GITHUB_URL,
  }
}

export function LicenseRibbon() {
  const { t } = useTranslation()
  const { bound, edition, cloudDashboardUrl, isLoading } = useEntitlement()

  if (isLoading) return null

  const { labelKey, color, href } = resolveRibbon(bound, edition, cloudDashboardUrl)
  const label = t(labelKey)

  return (
    // z-40: above the desktop sidebar (z-10) but below modal sheets (z-50),
    // so it does not intercept taps when the mobile sheet overlay is open.
    <div className="pointer-events-none fixed right-0 top-0 z-40 overflow-hidden" style={{ width: 120, height: 120 }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="pointer-events-auto absolute flex items-center justify-center text-center font-semibold text-white shadow"
        style={{
          backgroundColor: color,
          top: 24,
          right: -30,
          width: 120,
          fontSize: 11,
          lineHeight: '1.2',
          paddingTop: 5,
          paddingBottom: 5,
          transform: 'rotate(45deg)',
          transformOrigin: 'center center',
        }}
      >
        {label}
      </a>
    </div>
  )
}
