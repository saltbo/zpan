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
import { siteOptionsQueryKey, useSiteOptions } from '@/lib/site-options'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const settingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string(),
})

type SettingsValues = z.infer<typeof settingsSchema>

async function putOption(key: string, value: string) {
  const res = await fetch(`/api/admin/system/options/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Failed to save ${key}`)
  }
}

function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading } = useSiteOptions()

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { siteName: '', siteDescription: '' },
  })

  useEffect(() => {
    if (!data) return
    form.reset({
      siteName: data['site.name'] ?? '',
      siteDescription: data['site.description'] ?? '',
    })
  }, [data, form])

  const mutation = useMutation({
    mutationFn: async (values: SettingsValues) => {
      await putOption('site.name', values.siteName)
      await putOption('site.description', values.siteDescription)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err: Error) => {
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
      <div>
        <h2 className="text-xl font-semibold">{t('admin.settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
      </div>

      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="max-w-xl space-y-6">
        <section className="space-y-4 rounded-md border p-4">
          <h3 className="text-base font-medium">{t('admin.settings.siteSection')}</h3>

          <div className="space-y-1.5">
            <Label htmlFor="siteName">{t('admin.settings.siteName')}</Label>
            <Input id="siteName" {...form.register('siteName')} />
            {form.formState.errors.siteName && (
              <p className="text-xs text-destructive">{form.formState.errors.siteName.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="siteDescription">{t('admin.settings.siteDescription')}</Label>
            <textarea
              id="siteDescription"
              rows={4}
              {...form.register('siteDescription')}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
