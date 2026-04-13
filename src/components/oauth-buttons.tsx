import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { type AuthProvider, listAuthProviders } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { Button } from './ui/button'

const PROVIDER_ICONS: Record<string, string> = {
  github: '🐙',
  google: '🔵',
  microsoft: '🪟',
  apple: '🍎',
  discord: '💬',
  gitlab: '🦊',
  twitter: '𝕏',
  facebook: '📘',
  slack: '💼',
  linkedin: '💼',
  spotify: '🎵',
  twitch: '🎮',
}

function ProviderButton({ provider }: { provider: AuthProvider }) {
  const icon = PROVIDER_ICONS[provider.icon] ?? '🔑'

  function handleClick() {
    authClient.signIn.social({
      provider: provider.providerId,
      callbackURL: '/files',
    })
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick}>
      <span className="mr-2">{icon}</span>
      {provider.name}
    </Button>
  )
}

export function OAuthButtons() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: listAuthProviders,
    staleTime: 5 * 60 * 1000,
  })

  const providers = data?.items ?? []

  if (isLoading || providers.length === 0) return null

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
          <ProviderButton key={provider.providerId} provider={provider} />
        ))}
      </div>
    </div>
  )
}
