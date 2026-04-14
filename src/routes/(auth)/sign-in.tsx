import { SignupMode } from '@shared/constants'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthButtons } from '@/components/oauth-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteOptions } from '@/hooks/use-site-options'
import { signIn } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignIn,
})

function SignIn() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Only allow same-origin relative redirects (starts with / but not //) to prevent
  // open redirect and javascript: URI attacks.
  const rawRedirect = new URLSearchParams(window.location.search).get('redirect')
  const redirectTo = rawRedirect && /^\/(?!\/)/.test(rawRedirect) ? rawRedirect : null
  const { authSignupMode } = useSiteOptions()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)
      const result = isEmail
        ? await signIn.email({ email: identity, password, callbackURL: '/files' })
        : await signIn.username({ username: identity, password, callbackURL: '/files' })

      if (result.error) {
        setError(result.error.message ?? t('auth.signInFailed'))
        return
      }
      if (redirectTo) {
        window.location.href = redirectTo
      } else {
        navigate({ to: '/files' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
          <p className="text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identity">{t('auth.emailOrUsername')}</Label>
            <Input
              id="identity"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder={t('auth.emailOrUsernamePlaceholder')}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
        <OAuthButtons />
        {authSignupMode !== SignupMode.CLOSED && (
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.noAccount')}{' '}
            <Link to="/sign-up" className="underline hover:text-foreground">
              {t('auth.signUp')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
