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
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { setSystemOption } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const settingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { siteName, siteDescription, isLoading } = useSiteOptions()

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { siteName: '', siteDescription: '' },
  })

  useEffect(() => {
    if (isLoading) return
    form.reset({ siteName, siteDescription })
  }, [isLoading, siteName, siteDescription, form])

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await setSystemOption('site_name', values.siteName, true)
      await setSystemOption('site_description', values.siteDescription, true)
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

        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </form>
    </div>
  )
}
