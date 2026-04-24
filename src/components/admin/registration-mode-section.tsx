import { SignupMode } from '@shared/constants'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { useEntitlement } from '@/hooks/useEntitlement'
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
  const { hasFeature } = useEntitlement()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const hasOpenReg = hasFeature('open_registration')

  const mutation = useMutation({
    mutationFn: (mode: string) => setSystemOption('auth_signup_mode', mode, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.auth.registrationSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  function handleModeChange(mode: string) {
    if (mode === SignupMode.OPEN && !hasOpenReg) {
      setUpgradeOpen(true)
      return
    }
    mutation.mutate(mode)
  }

  return (
    <>
      <div className="space-y-4 rounded-md border p-4">
        <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.registrationSection')}</h3>
        <div className="space-y-3">
          {modes.map((mode) => {
            const isOpenGated = mode.value === SignupMode.OPEN && !hasOpenReg
            return (
              <Label
                key={mode.value}
                className="flex items-start gap-3 cursor-pointer"
                onClick={isOpenGated ? () => setUpgradeOpen(true) : undefined}
              >
                <input
                  type="radio"
                  name="signupMode"
                  value={mode.value}
                  checked={authSignupMode === mode.value}
                  onChange={() => handleModeChange(mode.value)}
                  disabled={mutation.isPending || isOpenGated}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {t(mode.labelKey)}
                    {isOpenGated && <ProBadge />}
                  </div>
                  <div className="text-xs text-muted-foreground">{t(mode.descKey)}</div>
                </div>
              </Label>
            )
          })}
        </div>
      </div>
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <UpgradeHint feature="open_registration" />
        </DialogContent>
      </Dialog>
    </>
  )
}
