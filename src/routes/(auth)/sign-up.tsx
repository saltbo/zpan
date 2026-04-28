import { DEFAULT_SITE_NAME, SignupMode } from '@shared/constants'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthButtons, useOAuthProviders } from '@/components/oauth-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useSiteOptions } from '@/hooks/use-site-options'
import { ApiError, getSiteInvitation } from '@/lib/api'
import { signUp } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
  }),
  component: SignUp,
})

function SignUp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { invite } = Route.useSearch()
  const { authSignupMode, isLoading: optionsLoading, siteName } = useSiteOptions()
  const { providers } = useOAuthProviders()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [formExpanded, setFormExpanded] = useState(providers.length <= 3)
  const siteInvitationQuery = useQuery({
    queryKey: ['site-invitation', invite],
    queryFn: () => getSiteInvitation(invite ?? ''),
    enabled: Boolean(invite),
    retry: false,
  })

  useEffect(() => {
    if (siteInvitationQuery.data?.email) {
      setEmail(siteInvitationQuery.data.email)
    }
  }, [siteInvitationQuery.data?.email])

  const siteInvitation = siteInvitationQuery.data
  const inviteError = siteInvitationQuery.error instanceof ApiError ? siteInvitationQuery.error.message : ''
  const hasInvite = Boolean(invite)
  const hasValidInvite = Boolean(siteInvitation && siteInvitation.status === 'pending')
  const mustUseInvitation = authSignupMode === SignupMode.CLOSED
  const showClosedView = mustUseInvitation && !hasInvite
  const showInvalidInviteView =
    mustUseInvitation &&
    hasInvite &&
    !siteInvitationQuery.isLoading &&
    (!siteInvitation || siteInvitation.status !== 'pending')

  if (showClosedView) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6 p-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
            <p className="text-muted-foreground">{t('auth.registrationClosed')}</p>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.hasAccount')}{' '}
            <Link to="/sign-in" className="underline hover:text-foreground">
              {t('auth.signIn')}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  if (mustUseInvitation && hasInvite && siteInvitationQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6 p-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    )
  }

  if (showInvalidInviteView) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6 p-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
            <p className="text-muted-foreground">{t('auth.invalidInvitation')}</p>
            <p className="text-sm text-muted-foreground">
              {siteInvitation?.status === 'expired'
                ? t('auth.invitationExpired')
                : siteInvitation?.status === 'accepted'
                  ? t('auth.invitationUsed')
                  : siteInvitation?.status === 'revoked'
                    ? t('auth.invitationRevoked')
                    : inviteError || t('auth.invitationMissing')}
            </p>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.hasAccount')}{' '}
            <Link to="/sign-in" className="underline hover:text-foreground">
              {t('auth.signIn')}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signUp.email({
        username,
        name: '',
        email,
        password,
        callbackURL: '/files',
        ...(authSignupMode === SignupMode.INVITE_ONLY ? { inviteCode } : {}),
        ...(hasValidInvite && invite ? { siteInvitationToken: invite } : {}),
      })
      if (result.error) {
        setError(result.error.message ?? t('auth.signUpFailed'))
        return
      }
      navigate({ to: '/files' })
    } finally {
      setLoading(false)
    }
  }

  const showDivider = providers.length > 0

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{siteName || DEFAULT_SITE_NAME}</h1>
          <p className="text-muted-foreground">{t('auth.signUpSubtitle')}</p>
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
            {t('auth.signUpWithEmail')}
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={hasValidInvite}
                required
              />
            </div>
            {hasValidInvite && siteInvitation && (
              <p className="text-sm text-muted-foreground">
                {t('auth.invitationEmailLocked', { email: siteInvitation.email })}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.username')}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                pattern="^[a-zA-Z0-9_]{3,30}$"
                title={t('auth.usernameHint')}
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
            {authSignupMode === SignupMode.INVITE_ONLY && (
              <div className="space-y-2">
                <Label htmlFor="inviteCode">{t('auth.inviteCode')}</Label>
                <Input id="inviteCode" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || optionsLoading || (mustUseInvitation && !hasValidInvite)}
            >
              {loading ? t('auth.creatingAccount') : t('auth.signUp')}
            </Button>
          </form>
        )}
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.hasAccount')}{' '}
          <Link to="/sign-in" className="underline hover:text-foreground">
            {t('auth.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
