import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthButtons } from '@/components/oauth-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteOptions } from '@/hooks/use-site-options'
import { signUp } from '@/lib/auth-client'

export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
})

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/

function SignUp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { authSignupMode, isLoading: optionsLoading } = useSiteOptions()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [loading, setLoading] = useState(false)

  if (optionsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm p-6 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
        </div>
      </div>
    )
  }

  if (authSignupMode === 'closed') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6 p-6 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
          <p className="text-muted-foreground">{t('auth.registrationClosed')}</p>
          <Link to="/sign-in" className="text-sm underline hover:text-foreground">
            {t('auth.signIn')}
          </Link>
        </div>
      </div>
    )
  }

  function validateUsername(value: string) {
    if (value && !USERNAME_RE.test(value)) {
      setUsernameError(t('auth.usernameInvalid'))
    } else {
      setUsernameError('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!USERNAME_RE.test(username)) {
      setUsernameError(t('auth.usernameInvalid'))
      return
    }
    if (authSignupMode === 'invite_only' && !inviteCode.trim()) {
      setError(t('auth.inviteCodeRequired'))
      return
    }
    setError('')
    setLoading(true)

    const result = await signUp.email({
      username,
      name,
      email,
      password,
      callbackURL: '/files',
      ...(authSignupMode === 'invite_only' ? { inviteCode } : {}),
    })
    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? t('auth.signUpFailed'))
      return
    }
    navigate({ to: '/files' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">ZPan</h1>
          <p className="text-muted-foreground">{t('auth.signUpSubtitle')}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{t('auth.username')}</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                validateUsername(e.target.value)
              }}
              placeholder={t('auth.usernamePlaceholder')}
              required
            />
            {usernameError && <p className="text-xs text-destructive">{usernameError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t('auth.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          {authSignupMode === 'invite_only' && (
            <div className="space-y-2">
              <Label htmlFor="inviteCode">{t('auth.inviteCode')}</Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={t('auth.inviteCodePlaceholder')}
                required
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth.creatingAccount') : t('auth.signUp')}
          </Button>
        </form>
        <OAuthButtons />
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
