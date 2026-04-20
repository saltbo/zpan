import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, verifySharePassword } from '@/lib/api'

interface PasswordPromptProps {
  token: string
  fileName: string
  onUnlocked: () => void
}

export function PasswordPrompt({ token, fileName, onUnlocked }: PasswordPromptProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await verifySharePassword(token, password)
      onUnlocked()
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t('share.passwordWrong'))
      } else {
        setError(t('share.loadError'))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">{t('share.passwordTitle')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{fileName}</p>
        <p className="mb-4 text-sm text-muted-foreground">{t('share.passwordDesc')}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="share-password">{t('share.passwordLabel')}</Label>
            <Input
              id="share-password"
              type="password"
              placeholder={t('share.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={pending || !password}>
            {t('share.passwordSubmit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
