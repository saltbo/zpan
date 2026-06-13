import { DEFAULT_SITE_NAME } from '@shared/constants'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteOptions } from '@/hooks/use-site-options'
import { resetPassword } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/reset-password')({
  component: ResetPassword,
})

function ResetPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { siteName } = useSiteOptions()
  const token = new URLSearchParams(window.location.search).get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!token) {
      setError(t('auth.resetTokenMissing'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordsDoNotMatch'))
      return
    }
    setLoading(true)
    try {
      const result = await resetPassword({ newPassword: password, token })
      if (result.error) {
        setError(result.error.message ?? t('auth.resetFailed'))
        return
      }
      navigate({ to: '/sign-in' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
          <p className="text-muted-foreground">{t('auth.resetPasswordSubtitle')}</p>
        </div>
        {token ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('auth.confirmPassword')}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.resetting') : t('auth.resetPassword')}
            </Button>
          </form>
        ) : (
          <p className="text-center text-sm text-destructive">{t('auth.resetTokenMissing')}</p>
        )}
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/sign-in" className="underline hover:text-foreground">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
