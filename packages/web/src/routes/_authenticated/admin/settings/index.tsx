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
import { Textarea } from '@/components/ui/textarea'
import { siteOptionsQueryKey, useSiteOptions, type SiteOptions } from '@/hooks/use-site-options'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const settingsSchema = z.object({
  siteName: z.string().min(1).max(100),
  siteDescription: z.string().max(500),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

const OPTION_KEYS = {
  siteName: 'site.name',
  siteDescription: 'site.description',
} as const

async function putOption(key: string, value: string): Promise<void> {
  const res = await fetch(`/api/admin/system/options/${encodeURIComponent(key)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Failed to update ${key}`)
  }
}

function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const optionsQuery = useSiteOptions()

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { siteName: '', siteDescription: '' },
  })

  useEffect(() => {
    if (!optionsQuery.data) return
    form.reset({
      siteName: optionsQuery.data['site.name'] ?? '',
      siteDescription: optionsQuery.data['site.description'] ?? '',
    })
  }, [optionsQuery.data, form])

  const mutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await putOption(OPTION_KEYS.siteName, values.siteName)
      await putOption(OPTION_KEYS.siteDescription, values.siteDescription)
      return values
    },
    onSuccess: (values) => {
      queryClient.setQueryData<SiteOptions>(siteOptionsQueryKey, (prev) => ({
        ...(prev ?? { 'site.name': '', 'site.description': '' }),
        'site.name': values.siteName,
        'site.description': values.siteDescription,
      }))
      toast.success(t('admin.settings.saved'))
    },
    onError: (err: Error) => {
      toast.error(err.message || t('admin.settings.saveFailed'))
    },
  })

  function onSubmit(values: SettingsFormValues) {
    mutation.mutate(values)
  }

  if (optionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t('admin.settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-6 rounded-md border p-6">
        <div>
          <h3 className="text-base font-medium">{t('admin.settings.siteSection')}</h3>
        </div>

        <div className="space-y-2">
          <Label htmlFor="siteName">{t('admin.settings.siteName')}</Label>
          <Input id="siteName" {...form.register('siteName')} aria-invalid={!!form.formState.errors.siteName} />
          {form.formState.errors.siteName && (
            <p className="text-xs text-destructive">{form.formState.errors.siteName.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="siteDescription">{t('admin.settings.siteDescription')}</Label>
          <Textarea
            id="siteDescription"
            rows={3}
            {...form.register('siteDescription')}
            aria-invalid={!!form.formState.errors.siteDescription}
          />
          {form.formState.errors.siteDescription && (
            <p className="text-xs text-destructive">{form.formState.errors.siteDescription.message}</p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
            {mutation.isPending ? t('admin.settings.saving') : t('admin.settings.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
