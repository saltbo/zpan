import { SignupMode } from '@shared/constants'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthButtons, useOAuthProviders } from '@/components/oauth-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useSiteOptions } from '@/hooks/use-site-options'
import { signIn } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignIn,
})

function SignIn() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const redirectTo: string | null = (() => {
    const raw = new URLSearchParams(window.location.search).get('redirect')
    if (!raw) return null
    try {
      const parsed = new URL(raw, window.location.origin)
      if (parsed.origin !== window.location.origin) return null
      return parsed.pathname + parsed.search + parsed.hash
    } catch {
      return null
    }
  })()
  const { authSignupMode } = useSiteOptions()
  const { providers } = useOAuthProviders()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [formExpanded, setFormExpanded] = useState(providers.length <= 3)

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

  const showDivider = providers.length > 0

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
          <p className="text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </div>
        <OAuthButtons />
        {showDivider && (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{t('auth.orDivider')}</span>
            <Separator className="flex-1" />
          </div>
        )}
        {providers.length > 3 && !formExpanded ? (
          <button
            type="button"
            onClick={() => setFormExpanded(true)}
            className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {t('auth.signInWithEmail')}
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : (
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
        )}
        {authSignupMode !== SignupMode.CLOSED && (
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.noAccount')}{' '}
            <Link to="/sign-up" search={{ invite: undefined }} className="underline hover:text-foreground">
              {t('auth.signUp')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
