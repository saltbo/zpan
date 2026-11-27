import type { TorrentSettings } from '@shared/schemas'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField, AdminSwitchField } from '@/components/admin/admin-form-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { replaceTorrentSettings } from '@/lib/api'
import { formLevelError, serverFieldError } from '@/lib/form-errors'

const CAPACITY_UNITS = { GB: 1024 ** 3, TB: 1024 ** 4 } as const
type CapacityUnit = keyof typeof CAPACITY_UNITS

const SERVER_FIELDS = { retentionDays: 'retentionDays', capacityBytes: 'capacity' } as const

type Form = { retentionDays: string; limitCapacity: boolean; capacity: string; unit: CapacityUnit }

function formFromSettings(settings: TorrentSettings): Form {
  const bytes = settings.capacityBytes
  if (bytes === null)
    return { retentionDays: String(settings.retentionDays), limitCapacity: false, capacity: '', unit: 'TB' }
  const unit: CapacityUnit = bytes >= CAPACITY_UNITS.TB && bytes % CAPACITY_UNITS.TB === 0 ? 'TB' : 'GB'
  return {
    retentionDays: String(settings.retentionDays),
    limitCapacity: true,
    capacity: String(Number((bytes / CAPACITY_UNITS[unit]).toFixed(2))),
    unit,
  }
}

function isWholeNumberIn(value: string, min: number, max: number): boolean {
  const n = Number(value)
  return value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max
}

export function TorrentSettingsDrawer({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: TorrentSettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const initial = formFromSettings(settings)
  const [form, setForm] = useState<Form>(initial)

  const mutation = useMutation({
    mutationFn: (input: TorrentSettings) => replaceTorrentSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin', 'torrent-settings'], saved)
      onOpenChange(false)
      toast.success(t('admin.torrents.settings.saved'))
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (next) setForm(formFromSettings(settings))
    mutation.reset()
    onOpenChange(next)
  }

  const retentionError = isWholeNumberIn(form.retentionDays, 1, 3650)
    ? undefined
    : t('admin.torrents.settings.retentionInvalid')
  const capacityValue = Number(form.capacity)
  const capacityError =
    !form.limitCapacity || (form.capacity.trim() !== '' && Number.isFinite(capacityValue) && capacityValue > 0)
      ? undefined
      : t('admin.torrents.settings.capacityInvalid')
  const serverError = serverFieldError(mutation.error, SERVER_FIELDS)
  const unchanged =
    form.retentionDays === initial.retentionDays &&
    form.limitCapacity === initial.limitCapacity &&
    (!form.limitCapacity || (form.capacity === initial.capacity && form.unit === initial.unit))
  const canSave = !retentionError && !capacityError && !unchanged && !mutation.isPending

  const submit = () => {
    if (!canSave) return
    mutation.mutate({
      retentionDays: Number(form.retentionDays),
      capacityBytes: form.limitCapacity ? Math.round(capacityValue * CAPACITY_UNITS[form.unit]) : null,
    })
  }

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={handleOpenChange}
      title={t('admin.torrents.settings.title')}
      description={t('admin.torrents.settings.description')}
      bodyClassName="grid auto-rows-min content-start gap-4"
      error={formLevelError(mutation.error, SERVER_FIELDS)}
      formProps={{
        onSubmit: (event) => {
          event.preventDefault()
          submit()
        },
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <AdminFormField
        id="torrentRetentionDays"
        label={t('admin.torrents.settings.retention')}
        help={t('admin.torrents.settings.retentionHelp')}
        required
        error={
          serverError?.field === 'retentionDays' ? serverError.message : form.retentionDays ? retentionError : undefined
        }
      >
        <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
          <Input
            id="torrentRetentionDays"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={form.retentionDays}
            placeholder="30"
            onChange={(event) => setForm({ ...form, retentionDays: event.target.value })}
            className="h-8 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <span className="border-l px-3 text-sm text-muted-foreground">{t('admin.torrents.settings.days')}</span>
        </div>
      </AdminFormField>

      <AdminSwitchField
        id="torrentLimitCapacity"
        label={t('admin.torrents.settings.limitCapacity')}
        help={t('admin.torrents.settings.limitCapacityHelp')}
        checked={form.limitCapacity}
        onCheckedChange={(limitCapacity) => setForm({ ...form, limitCapacity })}
      />

      <AdminFormField
        id="torrentCapacity"
        label={t('admin.torrents.settings.capacity')}
        required={form.limitCapacity}
        error={serverError?.field === 'capacity' ? serverError.message : form.capacity ? capacityError : undefined}
      >
        <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 dark:bg-input/30">
          <Input
            id="torrentCapacity"
            type="number"
            min={0}
            step="any"
            value={form.capacity}
            placeholder="2"
            disabled={!form.limitCapacity}
            onChange={(event) => setForm({ ...form, capacity: event.target.value })}
            className="h-8 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Select
            value={form.unit}
            disabled={!form.limitCapacity}
            onValueChange={(unit) => setForm({ ...form, unit: unit as CapacityUnit })}
          >
            <SelectTrigger
              aria-label={t('admin.torrents.settings.capacityUnit')}
              className="h-8 w-20 rounded-none border-0 border-l bg-transparent px-2 shadow-none focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GB">GB</SelectItem>
              <SelectItem value="TB">TB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </AdminFormField>
    </AdminFormDrawer>
  )
}
