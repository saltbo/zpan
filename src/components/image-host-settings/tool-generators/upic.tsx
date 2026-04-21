import { useTranslation } from 'react-i18next'
import { buildUPicFields } from '@/lib/tool-configs'
import { CopyableField } from './copyable-field'

interface UPicGeneratorProps {
  appHost: string
  userKey: string
}

export function UPicGenerator({ appHost, userKey }: UPicGeneratorProps) {
  const { t } = useTranslation()
  const fields = buildUPicFields({ appHost, userKey })

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.ihost.tools.upic.instructions')}</p>
      <div className="space-y-2.5">
        {fields.map((field) => (
          <CopyableField key={field.label} {...field} />
        ))}
      </div>
    </div>
  )
}
