import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { IhostConfigResponse } from '@/lib/api'
import { updateIhostConfig } from '@/lib/api'

const IHOST_CONFIG_QUERY_KEY = (orgId: string) => ['ihost', 'config', orgId] as const
const refererOriginRegex = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function validateOrigins(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!refererOriginRegex.test(lines[i])) {
      return `Line ${i + 1}: "${lines[i]}" is not a valid origin`
    }
  }
  return null
}

interface RefererAllowlistPanelProps {
  orgId: string
  config: IhostConfigResponse
}

export function RefererAllowlistPanel({ orgId, config }: RefererAllowlistPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [text, setText] = useState((config.refererAllowlist ?? []).join('\n'))
  const [validationError, setValidationError] = useState('')

  const saveMutation = useMutation({
    mutationFn: (allowlist: string[] | null) => updateIhostConfig({ refererAllowlist: allowlist }),
    onSuccess: () => {
      toast.success(t('settings.ihost.refererAllowlist.saved'))
      queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
    },
    onError: (err) => toast.error(err.message),
  })

  function handleSave() {
    const lines = parseLines(text)
    const error = validateOrigins(lines)
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError('')
    saveMutation.mutate(lines.length > 0 ? lines : null)
  }

  const initialText = (config.refererAllowlist ?? []).join('\n')
  const isDirty = text !== initialText

  return (
    <Card className="gap-4 p-4 shadow-none">
      <h3 className="text-sm font-medium text-muted-foreground">{t('settings.ihost.refererAllowlist.section')}</h3>
      <p className="text-xs text-muted-foreground">{t('settings.ihost.refererAllowlist.description')}</p>

      <div className="space-y-1.5">
        <Label htmlFor="refererAllowlist">{t('settings.ihost.refererAllowlist.section')}</Label>
        <Textarea
          id="refererAllowlist"
          rows={5}
          placeholder={t('settings.ihost.refererAllowlist.placeholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setValidationError('')
          }}
        />
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
      </div>

      <Button onClick={handleSave} disabled={!isDirty || saveMutation.isPending}>
        {saveMutation.isPending ? t('common.loading') : t('settings.ihost.refererAllowlist.save')}
      </Button>
    </Card>
  )
}
