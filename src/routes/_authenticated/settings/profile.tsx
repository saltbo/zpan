import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfilePage,
})

const profileSchema = z.object({
  displayName: z.string().min(1).max(100),
})

type ProfileFormValues = z.infer<typeof profileSchema>

export function ProfileForm() {
  const { t } = useTranslation()
  const { data: session } = useSession()

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '' },
  })

  useEffect(() => {
    if (session?.user?.name) {
      form.reset({ displayName: session.user.name })
    }
  }, [session?.user?.name, form])

  const mutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const { error } = await authClient.updateUser({ name: values.displayName })
      if (error) throw error
    },
    onSuccess: () => toast.success(t('settings.profile.saved')),
    onError: (err) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">{t('settings.profile.displayName')}</Label>
        <Input id="displayName" {...form.register('displayName')} />
        {form.formState.errors.displayName && (
          <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="username">{t('settings.profile.username')}</Label>
        <Input id="username" value={(session?.user as { username?: string })?.username ?? ''} disabled />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">{t('settings.profile.email')}</Label>
        <Input id="email" value={session?.user?.email ?? ''} disabled />
        <p className="text-xs text-muted-foreground">{t('settings.profile.emailReadonly')}</p>
      </div>

      <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
        {mutation.isPending ? t('common.loading') : t('common.save')}
      </Button>
    </form>
  )
}

function ProfilePage() {
  const { t } = useTranslation()

  return (
    <div className="max-w-lg">
      <div className="space-y-4 rounded-md border p-4">
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.profile.section')}</h3>
        <ProfileForm />
      </div>
    </div>
  )
}
