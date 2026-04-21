import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteIhostConfig } from '@/lib/api'

const IHOST_CONFIG_QUERY_KEY = (orgId: string) => ['ihost', 'config', orgId] as const
const CONFIRM_WORD = 'DISABLE'

interface DisableFeaturePanelProps {
  orgId: string
}

export function DisableFeaturePanel({ orgId }: DisableFeaturePanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const disableMutation = useMutation({
    mutationFn: deleteIhostConfig,
    onSuccess: () => {
      toast.success(t('settings.ihost.disable.success'))
      queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
      navigate({ to: '/settings/profile' })
    },
    onError: (err) => toast.error(err.message),
  })

  function handleDisable() {
    if (confirmText !== CONFIRM_WORD) return
    disableMutation.mutate()
  }

  function handleClose() {
    setDialogOpen(false)
    setConfirmText('')
  }

  return (
    <>
      <Card className="gap-4 border-destructive/50 p-4 shadow-none">
        <h3 className="text-sm font-medium text-destructive">{t('settings.ihost.disable.section')}</h3>
        <p className="text-xs text-muted-foreground">{t('settings.ihost.disable.description')}</p>
        <Button variant="destructive" size="sm" onClick={() => setDialogOpen(true)}>
          {t('settings.ihost.disable.button')}
        </Button>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) handleClose()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.ihost.disable.title')}</DialogTitle>
            <DialogDescription>{t('settings.ihost.disable.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirmDisable">{t('settings.ihost.disable.confirmLabel')}</Label>
            <Input
              id="confirmDisable"
              placeholder={t('settings.ihost.disable.confirmPlaceholder')}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={disableMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={confirmText !== CONFIRM_WORD || disableMutation.isPending}
            >
              {disableMutation.isPending ? t('common.loading') : t('settings.ihost.disable.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
