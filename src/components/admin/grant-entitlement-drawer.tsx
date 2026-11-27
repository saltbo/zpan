import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { DATA_UNITS, DataAmountInput, type DataUnit } from '@/components/admin/data-amount-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { grantOrgEntitlement, grantUserEntitlement, updateOrgEntitlement, updateUserEntitlement } from '@/lib/api'

interface EditableEntitlement {
  id: string
  bytes: number
  expiresAt: string | null
  metadata: string | null
}

// One dialog for both user and team entitlements — only the API calls and the
// cache keys to invalidate differ between the two.
export type EntitlementTarget =
  | { kind: 'user'; id: string; name: string }
  | { kind: 'team'; orgId: string; name: string }

interface GrantEntitlementDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: EntitlementTarget | null
  entitlement?: EditableEntitlement | null
}

type GrantPayload = { bytes: number; expiresAt: string | null; note: string | null }

// Bind the target to its API calls and the query keys its pages depend on.
function targetBinding(target: EntitlementTarget) {
  if (target.kind === 'user') {
    return {
      grant: (data: GrantPayload) => grantUserEntitlement(target.id, { resourceType: 'storage', ...data }),
      update: (id: string, data: GrantPayload) => updateUserEntitlement(target.id, id, data),
      invalidate: [
        ['admin', 'users'],
        ['admin', 'users', target.id],
        ['admin', 'users', target.id, 'entitlements'],
      ],
    }
  }
  return {
    grant: (data: GrantPayload) => grantOrgEntitlement(target.orgId, { resourceType: 'storage', ...data }),
    update: (id: string, data: GrantPayload) => updateOrgEntitlement(target.orgId, id, data),
    invalidate: [
      ['admin', 'teams'],
      ['admin', 'teams', target.orgId, 'entitlements'],
    ],
  }
}

function bytesToAmountUnit(bytes: number): { amount: string; unit: DataUnit } {
  for (const unit of ['TB', 'GB', 'MB'] as DataUnit[]) {
    const factor = DATA_UNITS[unit]
    if (bytes % factor === 0) return { amount: String(bytes / factor), unit }
  }
  return { amount: String(bytes / DATA_UNITS.GB), unit: 'GB' }
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

export function GrantEntitlementDrawer({ open, onOpenChange, target, entitlement }: GrantEntitlementDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = !!entitlement
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<DataUnit>('GB')
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
      if (!target) throw new Error('target_required')
      const value = Number(amount)
      if (!Number.isFinite(value) || value <= 0) throw new Error(t('admin.entitlement.positiveQuotaRequired'))
      const payload: GrantPayload = {
        bytes: Math.round(value * DATA_UNITS[unit]),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        note: note.trim() || null,
      }
      const binding = targetBinding(target)
      return entitlement ? binding.update(entitlement.id, payload) : binding.grant(payload)
    },
    onSuccess: () => {
      if (target) {
        for (const key of targetBinding(target).invalidate) {
          queryClient.invalidateQueries({ queryKey: key })
        }
      }
      toast.success(isEdit ? t('admin.entitlement.updated') : t('admin.entitlement.granted'))
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (!target) return null

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? t('admin.entitlement.editFor', { name: target.name })
          : t('admin.entitlement.grantFor', { name: target.name })
      }
      description={isEdit ? t('admin.entitlement.editDescription') : t('admin.entitlement.grantDescription')}
      bodyClassName="grid auto-rows-min content-start gap-4"
      formProps={{
        onSubmit: (event) => {
          event.preventDefault()
          mutation.mutate()
        },
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.loading')
              : isEdit
                ? t('admin.entitlement.save')
                : t('admin.entitlement.grant')}
          </Button>
        </>
      }
    >
      <AdminFormField id="entitlement-amount" label={t('admin.entitlement.amount')} required>
        <div>
          <DataAmountInput
            id="entitlement-amount"
            min={0.1}
            step={0.1}
            value={amount}
            unit={unit}
            required
            onValueChange={setAmount}
            onUnitChange={setUnit}
          />
        </div>
      </AdminFormField>
      <AdminFormField id="entitlement-expires" label={t('admin.entitlement.expires')}>
        <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      </AdminFormField>
      <AdminFormField id="entitlement-note" label={t('admin.entitlement.note')}>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
      </AdminFormField>
    </AdminFormDrawer>
  )
}
