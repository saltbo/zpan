import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listIhostApiKeys } from '@/lib/api'
import { PicGoGenerator } from './tool-generators/picgo'
import { ShareXGenerator } from './tool-generators/sharex'
import { UPicGenerator } from './tool-generators/upic'

type ToolId = 'picgo' | 'upic' | 'sharex'

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'picgo', label: 'PicGo / PicList' },
  { id: 'upic', label: 'uPic' },
  { id: 'sharex', label: 'ShareX' },
]

interface ToolIntegrationPanelProps {
  orgId: string
}

export function ToolIntegrationPanel({ orgId }: ToolIntegrationPanelProps) {
  const { t } = useTranslation()
  const appHost = window.location.origin

  const keysQuery = useQuery({
    queryKey: ['ihost', 'api-keys', orgId],
    queryFn: () => listIhostApiKeys(orgId),
  })
  const apiKeys = keysQuery.data ?? []

  // selectedKeyId is just a reference label — plaintext is never stored server-side.
  // Users must paste the key they saved at creation time.
  const [selectedKeyId, setSelectedKeyId] = useState<string>('')
  const [pastedKey, setPastedKey] = useState('')
  const [activeTool, setActiveTool] = useState<ToolId>('picgo')

  const resolvedKey = pastedKey.trim() || '<userKey>'

  return (
    <Card className="gap-4 p-4 shadow-none">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.ihost.tools.section')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('settings.ihost.tools.description')}</p>
      </div>

      {apiKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.noKeys')}</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="toolKeySelect">{t('settings.ihost.tools.keyLabel')}</Label>
            <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
              <SelectTrigger id="toolKeySelect" className="w-full max-w-xs">
                <SelectValue placeholder={t('settings.ihost.tools.keyPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {apiKeys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name ?? k.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="toolKeyPaste">{t('settings.ihost.tools.pasteKeyLabel')}</Label>
            <Input
              id="toolKeyPaste"
              type="password"
              placeholder={t('settings.ihost.tools.pasteKeyPlaceholder')}
              value={pastedKey}
              onChange={(e) => setPastedKey(e.target.value)}
              className="max-w-xs font-mono"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.pasteKeyHint')}</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex gap-1 flex-wrap">
          {TOOLS.map((tool) => (
            <Button
              key={tool.id}
              variant={activeTool === tool.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.label}
            </Button>
          ))}
        </div>

        {activeTool === 'picgo' && <PicGoGenerator appHost={appHost} userKey={resolvedKey} />}
        {activeTool === 'upic' && <UPicGenerator appHost={appHost} userKey={resolvedKey} />}
        {activeTool === 'sharex' && <ShareXGenerator appHost={appHost} userKey={resolvedKey} />}
      </div>
    </Card>
  )
}
