import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAuthProviders } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { Button } from './ui/button'

export function OAuthButtons() {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const { data } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: listAuthProviders,
    staleTime: 5 * 60 * 1000,
  })

  const providers = data?.items ?? []
  if (providers.length === 0) return null

  async function handleOAuthSignIn(providerId: string) {
    setError('')
    const result = await authClient.signIn.social({ provider: providerId, callbackURL: '/files' })
    if (result.error) {
      setError(result.error.message ?? t('auth.signInFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">{t('auth.orContinueWith')}</span>
        </div>
      </div>
      <div className="space-y-2">
        {providers.map((provider) => (
          <Button
            key={provider.providerId}
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => handleOAuthSignIn(provider.providerId)}
          >
            {provider.name}
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
