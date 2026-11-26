import { DEFAULT_SITE_NAME } from '@shared/constants'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AmbientCanvas } from '@/components/layout/ambient-canvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteConfig } from '@/hooks/use-site-config'
import { requestPasswordReset } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPassword,
})

function ForgotPassword() {
  const { t } = useTranslation()
  const { data: siteConfig } = useSiteConfig()
  const siteName = siteConfig?.site.name ?? DEFAULT_SITE_NAME
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      // Always report success regardless of outcome — do not reveal whether
      // an account exists for the address.
      await requestPasswordReset({ email, redirectTo: '/reset-password' })
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <AmbientCanvas />
      <div className="relative w-full max-w-sm space-y-6 rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold bg-[image:var(--zpan-display-gradient)] bg-clip-text text-transparent">
            {siteName || DEFAULT_SITE_NAME}
          </h1>
          <p className="text-muted-foreground">{t('auth.forgotPasswordSubtitle')}</p>
        </div>
        {sent ? (
          <p className="rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">{t('auth.resetLinkSent')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.sending') : t('auth.sendResetLink')}
            </Button>
          </form>
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
