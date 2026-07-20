import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthProviderIcon } from '@/components/oauth-provider-icon'
import { Button } from '@/components/ui/button'
import { useSiteConfig } from '@/hooks/use-site-config'
import { authClient } from '@/lib/auth-client'

export function useOAuthProviders() {
  const { data, isLoading } = useSiteConfig()
  return { providers: data?.auth.providers ?? [], isLoading }
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
          key={provider.id}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth(provider.id)}
        >
          <OAuthProviderIcon icon={provider.icon} name={provider.name} />
          {t('auth.continueWith', { provider: provider.name })}
        </Button>
      ))}
    </div>
  )
}
