import { DEFAULT_SITE_NAME, SignupMode } from '@shared/constants'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProviderCaptcha } from '@/components/captcha/provider-captcha'
import { OAuthButtons, useOAuthProviders } from '@/components/oauth-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useSiteConfig } from '@/hooks/use-site-config'
import { authClient, signIn } from '@/lib/auth-client'
import { isCredentialLoginMethod } from '@/lib/last-login-method'

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
  const { data: siteConfig } = useSiteConfig()
  const authSignupMode = siteConfig?.auth.signupMode
  const captcha = siteConfig?.auth.captcha
  const siteName = siteConfig?.site.name ?? DEFAULT_SITE_NAME
  const { providers } = useOAuthProviders()
  const authProviders = providers
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [formExpanded, setFormExpanded] = useState(providers.length <= 3)
  const [captchaToken, setCaptchaToken] = useState('')
  const usedCredentialsLast = isCredentialLoginMethod(authClient.getLastUsedLoginMethod())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)
      const fetchOptions = captcha?.enabled ? { headers: { 'x-captcha-response': captchaToken } } : undefined
      const result = isEmail
        ? await signIn.email({ email: identity, password, callbackURL: '/files', fetchOptions })
        : await signIn.username({ username: identity, password, callbackURL: '/files', fetchOptions })

      if (result.error) {
        setError(
          result.error.code === 'EMAIL_NOT_VERIFIED'
            ? t('auth.emailNotVerified')
            : (result.error.message ?? t('auth.signInFailed')),
        )
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

  const showDivider = authProviders.length > 0

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
          <p className="text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </div>
        <OAuthButtons showLastUsed />
        {showDivider && (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{t('auth.orDivider')}</span>
            <Separator className="flex-1" />
          </div>
        )}
        {authProviders.length > 3 && !formExpanded ? (
          <button
            type="button"
            onClick={() => setFormExpanded(true)}
            className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {t('auth.signInWithEmail')}
            <ChevronDown className="h-4 w-4" />
            {usedCredentialsLast && <span className="text-xs">{t('auth.lastUsed')}</span>}
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Link to="/forgot-password" className="text-xs text-muted-foreground underline hover:text-foreground">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {captcha?.enabled && (
              <ProviderCaptcha provider={captcha.provider} siteKey={captcha.siteKey} onToken={setCaptchaToken} />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="relative w-full" disabled={loading || (captcha?.enabled && !captchaToken)}>
              {loading ? t('auth.signingIn') : t('auth.signIn')}
              {usedCredentialsLast && (
                <span className="absolute right-3 text-xs font-normal text-primary-foreground/70">
                  {t('auth.lastUsed')}
                </span>
              )}
            </Button>
          </form>
        )}
        {authSignupMode !== undefined && authSignupMode !== SignupMode.CLOSED && (
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
