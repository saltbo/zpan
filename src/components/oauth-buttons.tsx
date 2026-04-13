import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { listAuthProviders } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

export function OAuthButtons() {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: listAuthProviders,
    staleTime: 5 * 60 * 1000,
  })

  const providers = data?.items ?? []

  if (isLoading || providers.length === 0) return null

  async function handleOAuth(providerId: string) {
    setError('')
    const result = await authClient.signIn.social({ provider: providerId, callbackURL: '/files' })
    if (result.error) {
      setError(result.error.message ?? t('auth.signInFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">{t('auth.orDivider')}</span>
        <Separator className="flex-1" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
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
    </div>
  )
}
