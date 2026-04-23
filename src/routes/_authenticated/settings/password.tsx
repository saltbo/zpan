import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/password')({
  component: PasswordPage,
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

type PasswordFormValues = z.infer<typeof passwordSchema>

export function ChangePasswordForm() {
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
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.profile.changePassword')}</CardTitle>
          <CardDescription>{t('settings.profile.password.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{t('settings.profile.currentPassword')}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t('settings.profile.newPassword')}</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t('settings.profile.confirmPassword')}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
            {form.formState.errors.confirmPassword && (
              <p className="text-xs text-destructive">{t('settings.profile.passwordMismatch')}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-between border-t bg-muted/30">
          <p className="text-sm text-muted-foreground">{t('settings.profile.password.hint')}</p>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('settings.profile.changePassword')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function PasswordPage() {
  return (
    <div className="max-w-2xl">
      <ChangePasswordForm />
    </div>
  )
}
