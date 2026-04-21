import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { buildPicGoConfig } from '@/lib/tool-configs'

interface PicGoGeneratorProps {
  appHost: string
  userKey: string
}

export function PicGoGenerator({ appHost, userKey }: PicGoGeneratorProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const config = buildPicGoConfig({ appHost, userKey })

  function handleCopy() {
    navigator.clipboard.writeText(config).then(
      () => {
        setCopied(true)
        toast.success(t('settings.ihost.tools.copied'))
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error(t('common.error')),
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.picgo.instructions')}</p>
      <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{config}</pre>
      <Button variant="outline" size="sm" onClick={handleCopy}>
        {copied ? t('settings.ihost.tools.copiedLabel') : t('settings.ihost.tools.copy')}
      </Button>
    </div>
  )
}
