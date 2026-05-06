import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  emptyPackageForm,
  packageFormFromPackage,
  packageInputFromForm,
  QuotaStorePackageForm,
} from '@/components/admin/quota-store-package-form'
import { QuotaStorePackageList } from '@/components/admin/quota-store-package-list'
import {
  emptySettingsForm,
  QuotaStoreSettingsPanel,
  settingsInput,
} from '@/components/admin/quota-store-settings-panel'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Card, CardContent } from '@/components/ui/card'
import {
  ApiError,
  createQuotaStorePackage,
  getQuotaStoreSettings,
  listQuotaStorePackages,
  updateQuotaStorePackage,
  updateQuotaStoreSettings,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/quota-store')({
  component: AdminQuotaStorePage,
})

export function AdminQuotaStorePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<QuotaStorePackage | null>(null)
  const [form, setForm] = useState(emptyPackageForm)
  const [settingsForm, setSettingsForm] = useState(emptySettingsForm)
  const query = useQuery({ queryKey: ['admin', 'quota-store'], queryFn: loadAdminQuotaStore })
  const data = query.data

  useEffect(() => {
    if (!data?.settings) return
    setSettingsForm({
      enabled: data.settings.enabled,
    })
  }, [data?.settings])

  const settingsMutation = useMutation({
    mutationFn: (nextSettings: typeof emptySettingsForm) => updateQuotaStoreSettings(settingsInput(nextSettings)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store'] })
      toast.success(t('admin.quotaStore.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const packageMutation = useMutation({
    mutationFn: () => {
      const input = packageInputFromForm(form)
      return editing ? updateQuotaStorePackage(editing.id, input) : createQuotaStorePackage(input)
    },
    onSuccess: () => {
      setEditing(null)
      setForm(emptyPackageForm)
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store'] })
      toast.success(t('admin.quotaStore.packageSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (query.isLoading) return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  if (!data) return null

  function editPackage(pkg: QuotaStorePackage) {
    setEditing(pkg)
    setForm(packageFormFromPackage(pkg))
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{t('admin.quotaStore.title')}</h2>
            <ProBadge />
          </div>
          <p className="text-sm text-muted-foreground">{t('admin.quotaStore.subtitle')}</p>
        </div>
      </div>

      {!data.available && (
        <Card className="border-border/60">
          <CardContent className="pt-6">
            <UpgradeHint feature="quota_store" />
          </CardContent>
        </Card>
      )}

      <QuotaStoreSettingsPanel
        available={data.available}
        settings={data.settings}
        form={settingsForm}
        pending={settingsMutation.isPending}
        onFormChange={setSettingsForm}
        onSave={() => settingsMutation.mutate(settingsForm)}
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <QuotaStorePackageForm
          editing={editing}
          form={form}
          available={data.available}
          pending={packageMutation.isPending}
          onFormChange={setForm}
          onCancel={() => {
            setEditing(null)
            setForm(emptyPackageForm)
          }}
          onSubmit={() => packageMutation.mutate()}
        />

        <QuotaStorePackageList packages={data.packages} onEdit={editPackage} />
      </div>
    </div>
  )
}

async function loadAdminQuotaStore(): Promise<{
  available: boolean
  enabled: boolean
  settings: QuotaStoreSettings | null
  packages: QuotaStorePackage[]
}> {
  try {
    const [settings, packages] = await Promise.all([getQuotaStoreSettings(), listQuotaStorePackages()])
    return { available: true, enabled: settings?.enabled ?? false, settings, packages: packages.items }
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      return { available: false, enabled: false, settings: null, packages: [] }
    }
    throw err
  }
}
