import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsPage,
})

const profileSchema = z.object({
  displayName: z.string().min(1).max(100),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'passwords_mismatch',
    path: ['confirmPassword'],
  })

type ProfileFormValues = z.infer<typeof profileSchema>
type PasswordFormValues = z.infer<typeof passwordSchema>

function ProfileForm() {
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

function ChangePasswordForm() {
  const { t } = useTranslation()

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      const { error } = await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('settings.profile.passwordChanged'))
      form.reset()
    },
    onError: (err) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">{t('settings.profile.currentPassword')}</Label>
        <Input id="currentPassword" type="password" {...form.register('currentPassword')} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword">{t('settings.profile.newPassword')}</Label>
        <Input id="newPassword" type="password" {...form.register('newPassword')} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">{t('settings.profile.confirmPassword')}</Label>
        <Input id="confirmPassword" type="password" {...form.register('confirmPassword')} />
        {form.formState.errors.confirmPassword && (
          <p className="text-xs text-destructive">{t('settings.profile.passwordMismatch')}</p>
        )}
      </div>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t('common.loading') : t('settings.profile.changePassword')}
      </Button>
    </form>
  )
}

function AppearanceSection() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{t('settings.appearance.section')}</h3>

      <div className="space-y-1.5">
        <Label>{t('settings.appearance.theme')}</Label>
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t('settings.appearance.themeSystem')}</SelectItem>
            <SelectItem value="light">{t('settings.appearance.themeLight')}</SelectItem>
            <SelectItem value="dark">{t('settings.appearance.themeDark')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t('settings.appearance.language')}</Label>
        <Select value={i18n.language} onValueChange={(lang) => i18n.changeLanguage(lang)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="zh">中文</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function SettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('settings.title')}</h2>
      <div className="max-w-lg space-y-6">
        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{t('settings.profile.section')}</h3>
          <ProfileForm />
          <h3 className="text-sm font-medium text-muted-foreground">{t('settings.profile.changePassword')}</h3>
          <ChangePasswordForm />
        </div>
        <AppearanceSection />
      </div>
    </div>
  )
}
