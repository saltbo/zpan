import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type StoragePlansAdminTab = 'packages' | 'codes' | 'orders'

export function StoragePlansTabBar({
  activeTab,
  onChange,
}: {
  activeTab: StoragePlansAdminTab
  onChange: (tab: StoragePlansAdminTab) => void
}) {
  const { t } = useTranslation()
  const tabs: Array<{ id: StoragePlansAdminTab; label: string }> = [
    { id: 'packages', label: t('admin.storagePlans.tabs.packages') },
    { id: 'codes', label: t('admin.storagePlans.tabs.codes') },
    { id: 'orders', label: t('admin.storagePlans.tabs.orders') },
  ]
  return (
    <div role="tablist" className="flex w-full gap-6 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={activeTab === tab.id}
          className={`h-11 shrink-0 border-b-2 px-1 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function StoragePlansTabState({
  query,
  children,
}: {
  query: { isLoading: boolean; isError: boolean }
  children: ReactNode
}) {
  const { t } = useTranslation()
  if (query.isLoading) {
    return <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  if (query.isError) {
    return (
      <div className="rounded-md border border-destructive/40 p-8 text-center text-sm text-destructive">
        {t('admin.storagePlans.tabError')}
      </div>
    )
  }
  return <>{children}</>
}
