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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignIn,
})

function SignIn() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { authSignupMode, isLoading: optionsLoading } = useSiteOptions()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = EMAIL_RE.test(identifier)
      ? await signIn.email({ email: identifier, password, callbackURL: '/files' })
      : await signIn.username({ username: identifier, password, callbackURL: '/files' })

    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? t('auth.signInFailed'))
      return
    }
    navigate({ to: '/files' })
  }

  const showSignUpLink = !optionsLoading && authSignupMode !== SignupMode.CLOSED

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
          <p className="text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">{t('auth.emailOrUsername')}</Label>
            <Input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
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
        {showSignUpLink && (
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
