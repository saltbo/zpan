import { useTranslation } from 'react-i18next'
import { buildPicGoFields } from '@/lib/tool-configs'
import { CopyableField } from './copyable-field'

interface PicGoGeneratorProps {
  appHost: string
  userKey: string
}

export function PicGoGenerator({ appHost, userKey }: PicGoGeneratorProps) {
  const { t } = useTranslation()
  const fields = buildPicGoFields({ appHost, userKey })

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.picgo.instructions')}</p>
      <div className="space-y-2.5">
        {fields.map((field) => (
          <CopyableField key={field.label} {...field} />
        ))}
      </div>
    </div>
  )
}
