import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { buildShareXConfig, buildShareXConfigString } from '@/lib/tool-configs'

interface ShareXGeneratorProps {
  appHost: string
  userKey: string
}

export function ShareXGenerator({ appHost, userKey }: ShareXGeneratorProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const configStr = buildShareXConfigString({ appHost, userKey })

  function handleCopy() {
    navigator.clipboard.writeText(configStr).then(
      () => {
        setCopied(true)
        toast.success(t('settings.ihost.tools.copied'))
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error(t('common.error')),
    )
  }

  function handleDownload() {
    const config = buildShareXConfig({ appHost, userKey })
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'zpan-ihost.sxcu'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.sharex.instructions')}</p>
      <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{configStr}</pre>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? t('settings.ihost.tools.copiedLabel') : t('settings.ihost.tools.copy')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          {t('settings.ihost.tools.sharex.download')}
        </Button>
      </div>
    </div>
  )
}
