import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useEntitlement } from '@/hooks/useEntitlement'
import { EDITION_COLORS, editionKey } from '@/lib/license-edition'

export function LicenseRibbon() {
  const { t } = useTranslation()
  const { bound, edition, isLoading } = useEntitlement()

  if (isLoading) return null

  const key = editionKey(bound, edition)
  const label = t(`admin.licenseRibbon.${key}`)
  const color = EDITION_COLORS[key]

  return (
    <div data-slot="license-ribbon" className="pointer-events-none fixed right-0 top-0 z-50 h-24 w-24 overflow-hidden">
      <Link
        to="/admin/about"
        aria-label={t('admin.licenseRibbon.ariaLabel', { edition: label })}
        className="pointer-events-auto absolute -right-6 top-3 w-24 rotate-45 py-1 text-center text-xs font-semibold text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {label}
      </Link>
    </div>
  )
}
