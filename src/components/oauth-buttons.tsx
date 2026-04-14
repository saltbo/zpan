import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { listAuthProviders } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

export function useOAuthProviders() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: listAuthProviders,
    staleTime: 5 * 60 * 1000,
  })
  return { providers: data?.items ?? [], isLoading }
}

export function OAuthButtons() {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const { providers, isLoading } = useOAuthProviders()

  if (isLoading || providers.length === 0) return null

  async function handleOAuth(providerId: string) {
    setError('')
    const result = await authClient.signIn.social({ provider: providerId, callbackURL: '/files' })
    if (result.error) {
      setError(result.error.message ?? t('auth.signInFailed'))
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {providers.map((provider) => (
        <Button
          key={provider.providerId}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth(provider.providerId)}
        >
          {t('auth.continueWith', { provider: provider.name })}
        </Button>
      ))}
    </div>
  )
}
