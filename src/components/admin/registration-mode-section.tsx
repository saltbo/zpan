import { SignupMode } from '@shared/constants'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { setSystemOption } from '@/lib/api'

const modes = [
  { value: SignupMode.OPEN, labelKey: 'admin.auth.registrationOpen', descKey: 'admin.auth.registrationOpenDesc' },
  {
    value: SignupMode.INVITE_ONLY,
    labelKey: 'admin.auth.registrationInviteOnly',
    descKey: 'admin.auth.registrationInviteOnlyDesc',
  },
  {
    value: SignupMode.CLOSED,
    labelKey: 'admin.auth.registrationClosed',
    descKey: 'admin.auth.registrationClosedDesc',
  },
] as const

export function RegistrationModeSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { authSignupMode } = useSiteOptions()

  const mutation = useMutation({
    mutationFn: (mode: string) => setSystemOption('auth_signup_mode', mode, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.auth.registrationSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.registrationSection')}</h3>
      <div className="space-y-3">
        {modes.map((mode) => (
          <Label key={mode.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="signupMode"
              value={mode.value}
              checked={authSignupMode === mode.value}
              onChange={() => mutation.mutate(mode.value)}
              disabled={mutation.isPending}
              className="mt-1"
            />
            <div>
              <div className="font-medium">{t(mode.labelKey)}</div>
              <div className="text-xs text-muted-foreground">{t(mode.descKey)}</div>
            </div>
          </Label>
        ))}
      </div>
    </div>
  )
}
