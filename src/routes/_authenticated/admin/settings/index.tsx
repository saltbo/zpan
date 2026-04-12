import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { setSystemOption } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const UNITS = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024 } as const
type Unit = keyof typeof UNITS

function bytesToDisplay(bytes: number): { value: number; unit: Unit } {
  if (bytes >= UNITS.GB && bytes % UNITS.GB === 0) return { value: bytes / UNITS.GB, unit: 'GB' }
  return { value: bytes / UNITS.MB, unit: 'MB' }
}

const settingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string(),
  quotaValue: z.coerce.number().min(0),
  quotaUnit: z.enum(['MB', 'GB']),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { siteName, siteDescription, defaultOrgQuota: quotaBytes, isLoading } = useSiteOptions()

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { siteName: '', siteDescription: '', quotaValue: 0, quotaUnit: 'MB' as Unit },
  })

  useEffect(() => {
    if (isLoading) return
    const { value, unit } = bytesToDisplay(quotaBytes)
    form.reset({ siteName, siteDescription, quotaValue: value, quotaUnit: unit })
  }, [isLoading, siteName, siteDescription, quotaBytes, form])

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await setSystemOption('site_name', values.siteName, true)
      await setSystemOption('site_description', values.siteDescription, true)
      const bytes = values.quotaValue * UNITS[values.quotaUnit]
      await setSystemOption('default_org_quota', String(bytes), false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('admin.settings.title')}</h2>

      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="max-w-lg space-y-4">
        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{t('admin.settings.siteSection')}</h3>

          <div className="space-y-1.5">
            <Label htmlFor="siteName">{t('admin.settings.siteName')}</Label>
            <Input id="siteName" {...form.register('siteName')} />
            {form.formState.errors.siteName && (
              <p className="text-xs text-destructive">{form.formState.errors.siteName.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="siteDescription">{t('admin.settings.siteDescription')}</Label>
            <Textarea id="siteDescription" rows={3} {...form.register('siteDescription')} />
            {form.formState.errors.siteDescription && (
              <p className="text-xs text-destructive">{form.formState.errors.siteDescription.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{t('admin.settings.quotaSection')}</h3>

          <div className="space-y-1.5">
            <Label htmlFor="quotaValue">{t('admin.settings.defaultOrgQuota')}</Label>
            <div className="flex items-center gap-2">
              <Input id="quotaValue" type="number" min={0} step={1} className="w-32" {...form.register('quotaValue')} />
              <Select value={form.watch('quotaUnit')} onValueChange={(v) => form.setValue('quotaUnit', v as Unit)}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                = {formatSize(form.watch('quotaValue') * UNITS[form.watch('quotaUnit')])}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t('admin.settings.defaultOrgQuotaHint')}</p>
            {form.formState.errors.quotaValue && (
              <p className="text-xs text-destructive">{form.formState.errors.quotaValue.message}</p>
            )}
          </div>
        </div>

        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </form>
    </div>
  )
}
