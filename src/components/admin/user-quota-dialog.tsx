import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateQuota } from '@/lib/api'

interface UserQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; orgId: string; quotaUsed: number; quotaDefault: number } | null
  onSave?: (quota: number) => Promise<unknown>
  showSuccessToast?: boolean
}

const QUOTA_UNITS = ['MB', 'GB', 'TB'] as const
type QuotaUnit = (typeof QUOTA_UNITS)[number]
const UNIT_BYTES: Record<QuotaUnit, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
}

export function UserQuotaDialog({ open, onOpenChange, user, onSave, showSuccessToast = true }: UserQuotaDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [quotaValue, setQuotaValue] = useState('')
  const [quotaUnit, setQuotaUnit] = useState<QuotaUnit>('GB')

  useEffect(() => {
    if (open && user) {
      setQuotaUnit('GB')
      setQuotaValue(user.quotaDefault > 0 ? formatQuotaValue(user.quotaDefault, 'GB') : '')
    }
  }, [open, user])

  const mutation = useMutation({
    mutationFn: ({ orgId, quota }: { orgId: string; quota: number }) => onSave?.(quota) ?? updateQuota(orgId, quota),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] })
      onOpenChange(false)
      if (showSuccessToast) toast.success(t('admin.users.quotaUpdated'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setQuotaValue('')
    onOpenChange(nextOpen)
  }

  function handleUnitChange(nextUnit: QuotaUnit) {
    const value = Number(quotaValue)
    if (Number.isFinite(value) && value > 0) {
      setQuotaValue(formatQuotaValue(value * UNIT_BYTES[quotaUnit], nextUnit))
    }
    setQuotaUnit(nextUnit)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Number(quotaValue)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t('admin.users.positiveQuotaRequired'))
      return
    }
    mutation.mutate({ orgId: user.orgId, quota: Math.round(value * UNIT_BYTES[quotaUnit]) })
  }

  if (!user) return null

  const used = formatStorage(user.quotaUsed)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.setQuotaFor', { name: user.name })}</DialogTitle>
          <DialogDescription>{t('admin.users.currentUsage', { used })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quota">{t('admin.users.quotaLabel')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="quota"
                type="number"
                min="0.1"
                step="0.1"
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
                placeholder="10"
                required
              />
              <Select value={quotaUnit} onValueChange={(value) => handleUnitChange(value as QuotaUnit)}>
                <SelectTrigger className="w-24" aria-label={t('admin.users.quotaUnit')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUOTA_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t('admin.users.positiveQuotaHint')}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function formatQuotaValue(bytes: number, unit: QuotaUnit): string {
  return Number((bytes / UNIT_BYTES[unit]).toFixed(2)).toString()
}

function formatStorage(bytes: number): string {
  if (bytes >= UNIT_BYTES.TB) return `${formatQuotaValue(bytes, 'TB')} TB`
  if (bytes >= UNIT_BYTES.GB) return `${formatQuotaValue(bytes, 'GB')} GB`
  return `${formatQuotaValue(bytes, 'MB')} MB`
}
