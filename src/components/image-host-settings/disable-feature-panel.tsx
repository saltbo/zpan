import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('settings.ihost.disable.section')}</CardTitle>
          <CardDescription>{t('settings.ihost.disable.description')}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end border-t border-destructive/50 bg-destructive/5">
          <Button variant="destructive" size="sm" onClick={() => setDialogOpen(true)}>
            {t('settings.ihost.disable.button')}
          </Button>
        </CardFooter>
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
