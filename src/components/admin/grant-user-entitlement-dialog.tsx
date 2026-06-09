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
import { Textarea } from '@/components/ui/textarea'
import { grantUserEntitlement, updateUserEntitlement } from '@/lib/api'

interface EditableEntitlement {
  id: string
  bytes: number
  expiresAt: string | null
  metadata: string | null
}

interface GrantUserEntitlementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: string; name: string } | null
  entitlement?: EditableEntitlement | null
}

const QUOTA_UNITS = ['MB', 'GB', 'TB'] as const
type QuotaUnit = (typeof QUOTA_UNITS)[number]
const UNIT_BYTES: Record<QuotaUnit, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
}

function bytesToAmountUnit(bytes: number): { amount: string; unit: QuotaUnit } {
  for (const unit of ['TB', 'GB', 'MB'] as QuotaUnit[]) {
    const factor = UNIT_BYTES[unit]
    if (bytes % factor === 0) return { amount: String(bytes / factor), unit }
  }
  return { amount: String(bytes / UNIT_BYTES.GB), unit: 'GB' }
}

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function readNote(metadata: string | null): string {
  if (!metadata) return ''
  try {
    const parsed = JSON.parse(metadata) as { note?: unknown }
    return typeof parsed.note === 'string' ? parsed.note : ''
  } catch {
    return ''
  }
}

export function GrantUserEntitlementDialog({ open, onOpenChange, user, entitlement }: GrantUserEntitlementDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = !!entitlement
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<QuotaUnit>('GB')
  const [expiresAt, setExpiresAt] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    if (entitlement) {
      const { amount: prefillAmount, unit: prefillUnit } = bytesToAmountUnit(entitlement.bytes)
      setAmount(prefillAmount)
      setUnit(prefillUnit)
      setExpiresAt(isoToDatetimeLocal(entitlement.expiresAt))
      setNote(readNote(entitlement.metadata))
    } else {
      setAmount('')
      setUnit('GB')
      setExpiresAt('')
      setNote('')
    }
  }, [open, entitlement])

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('user_required')
      const value = Number(amount)
      if (!Number.isFinite(value) || value <= 0) throw new Error(t('admin.users.positiveQuotaRequired'))
      const payload = {
        bytes: Math.round(value * UNIT_BYTES[unit]),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        note: note.trim() || null,
      }
      if (entitlement) return updateUserEntitlement(user.id, entitlement.id, payload)
      return grantUserEntitlement(user.id, { resourceType: 'storage', ...payload })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', user?.id, 'entitlements'] })
      toast.success(isEdit ? t('admin.users.entitlementUpdated') : t('admin.users.entitlementGranted'))
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('admin.users.editEntitlementFor', { name: user.name })
              : t('admin.users.grantEntitlementFor', { name: user.name })}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t('admin.users.editEntitlementDescription') : t('admin.users.grantEntitlementDescription')}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px]">
            <div className="space-y-2">
              <Label htmlFor="entitlement-amount">{t('admin.users.entitlementAmount')}</Label>
              <Input
                id="entitlement-amount"
                type="number"
                min="0.1"
                step="0.1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.users.quotaUnit')}</Label>
              <Select value={unit} onValueChange={(value) => setUnit(value as QuotaUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUOTA_UNITS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="entitlement-expires">{t('admin.users.entitlementExpires')}</Label>
            <Input
              id="entitlement-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entitlement-note">{t('admin.users.entitlementNote')}</Label>
            <Textarea id="entitlement-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t('common.loading')
                : isEdit
                  ? t('admin.users.saveEntitlement')
                  : t('admin.users.grantEntitlement')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
