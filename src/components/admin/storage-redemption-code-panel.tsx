import type { GenerateStorageCodesInput, StorageCodeStatus } from '@shared/schemas'
import type { StorageRedemptionCode } from '@shared/types'
import { Ban, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/format'

const units = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof units

export const emptyCodeForm = {
  resourceType: 'storage' as 'storage' | 'traffic',
  size: '100',
  unit: 'GB' as Unit,
  maxUses: '1',
  expiresAt: '',
  count: '1',
}
export type CodeFormState = typeof emptyCodeForm

export function codeInputFromForm(form: CodeFormState): GenerateStorageCodesInput {
  const input: GenerateStorageCodesInput = {
    resourceType: form.resourceType,
    resourceBytes: Math.round(Number(form.size) * units[form.unit]),
    maxUses: Math.round(Number(form.maxUses)),
    count: Math.round(Number(form.count)),
  }
  if (form.expiresAt) input.expiresAt = new Date(form.expiresAt).toISOString()
  return input
}

export function StorageRedemptionCodePanel(props: CodeGenerateFormProps & CodeListProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <CodeToolbar {...props} />
      <div className="space-y-2">
        <CodeTable {...props} />
        {props.codes.length === 0 && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('admin.storagePlans.codes.empty')}
          </div>
        )}
      </div>
    </div>
  )
}

type CodeGenerateFormProps = {
  form: CodeFormState
  available: boolean
  pending: boolean
  onFormChange: (form: CodeFormState) => void
  onGenerate: () => void
}

function CodeToolbar(props: CodeGenerateFormProps & Pick<CodeListProps, 'status' | 'onStatusChange'>) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CodeStatusSelect status={props.status} onStatusChange={props.onStatusChange} />
      <CodeGenerateDialog {...props}>
        <Button disabled={!props.available}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.storagePlans.codes.generateTitle')}
        </Button>
      </CodeGenerateDialog>
    </div>
  )
}

function CodeGenerateDialog({
  children,
  ...props
}: CodeGenerateFormProps & {
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.storagePlans.codes.generateTitle')}</DialogTitle>
          <DialogDescription>{t('admin.storagePlans.codes.generateDescription')}</DialogDescription>
        </DialogHeader>
        <CodeGenerateForm
          {...props}
          onGenerate={() => {
            props.onGenerate()
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function CodeGenerateForm({ form, available, pending, onFormChange, onGenerate }: CodeGenerateFormProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <ResourceTypeField form={form} onFormChange={onFormChange} />
      <SizeFields form={form} onFormChange={onFormChange} />
      <NumberField
        id="codeMaxUses"
        label={t('admin.storagePlans.codes.maxUses')}
        value={form.maxUses}
        onChange={(maxUses) => onFormChange({ ...form, maxUses })}
      />
      <DateField value={form.expiresAt} onChange={(expiresAt) => onFormChange({ ...form, expiresAt })} />
      <NumberField
        id="codeCount"
        label={t('admin.storagePlans.codes.count')}
        value={form.count}
        max="100"
        onChange={(count) => onFormChange({ ...form, count })}
      />
      <Button className="w-full" disabled={!available || pending} onClick={onGenerate}>
        <Plus className="mr-2 h-4 w-4" />
        {t('admin.storagePlans.codes.generate')}
      </Button>
    </div>
  )
}

function ResourceTypeField({
  form,
  onFormChange,
}: {
  form: CodeFormState
  onFormChange: (form: CodeFormState) => void
}) {
  const { t } = useTranslation()
  return (
    <Field label={t('admin.storagePlans.resourceType')}>
      <Select
        value={form.resourceType}
        onValueChange={(resourceType: 'storage' | 'traffic') => onFormChange({ ...form, resourceType })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="storage">{t('admin.storagePlans.resourceStorage')}</SelectItem>
          <SelectItem value="traffic">{t('admin.storagePlans.resourceTraffic')}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}

function SizeFields({ form, onFormChange }: { form: CodeFormState; onFormChange: (form: CodeFormState) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_96px] gap-2">
      <NumberField
        id="codeSize"
        label={t('admin.storagePlans.size')}
        value={form.size}
        onChange={(size) => onFormChange({ ...form, size })}
      />
      <Field label={t('admin.storagePlans.unit')}>
        <Select value={form.unit} onValueChange={(unit: Unit) => onFormChange({ ...form, unit })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(units).map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  max,
  onChange,
}: {
  id: string
  label: string
  value: string
  max?: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" min="1" max={max} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation()
  return (
    <Field label={t('admin.storagePlans.codes.expiresAt')} htmlFor="codeExpiresAt">
      <Input
        id="codeExpiresAt"
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

type CodeListProps = {
  codes: StorageRedemptionCode[]
  status: StorageCodeStatus | 'all'
  available: boolean
  revokingCode: string | null
  deletingCode: string | null
  onStatusChange: (status: StorageCodeStatus | 'all') => void
  onRevoke: (code: string) => void
  onDelete: (code: string) => void
}

function CodeStatusSelect({ status, onStatusChange }: Pick<CodeListProps, 'status' | 'onStatusChange'>) {
  const { t } = useTranslation()
  return (
    <Select value={status} onValueChange={(value: StorageCodeStatus | 'all') => onStatusChange(value)}>
      <SelectTrigger className="h-9 w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(['all', 'active', 'redeemed', 'expired', 'revoked'] as const).map((value) => (
          <SelectItem key={value} value={value}>
            {t(`admin.storagePlans.codes.status.${value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CodeTable(props: CodeListProps) {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {['code', 'storage', 'uses', 'expires', 'statusLabel'].map((key) => (
              <TableHead key={key}>{t(`admin.storagePlans.codes.${key}`)}</TableHead>
            ))}
            <TableHead className="text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.codes.map((code) => (
            <CodeRow key={code.code} code={code} {...props} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CodeRow({
  code,
  available,
  revokingCode,
  deletingCode,
  onRevoke,
  onDelete,
}: CodeListProps & { code: StorageRedemptionCode }) {
  const { t } = useTranslation()
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const revoked = Boolean(code.revokedAt)
  const redeemed = code.usesCount >= code.maxUses
  const canRevoke = !revoked && !redeemed
  const canDelete = code.usesCount === 0
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{code.code}</TableCell>
      <TableCell>{formatSize(code.resourceBytes)}</TableCell>
      <TableCell>
        {code.usesCount}/{code.maxUses}
      </TableCell>
      <TableCell>{code.expiresAt ? new Date(code.expiresAt).toLocaleString() : '-'}</TableCell>
      <TableCell>
        <CodeStatusBadge code={code} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!available || !canRevoke || revokingCode === code.code}
            onClick={() => setRevokeConfirmOpen(true)}
          >
            <Ban className="mr-2 h-4 w-4" />
            {t('admin.storagePlans.codes.revoke')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!available || !canDelete || deletingCode === code.code}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('admin.storagePlans.codes.delete')}
          </Button>
        </div>
        <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.storagePlans.codes.revokeTitle')}</DialogTitle>
              <DialogDescription>{t('admin.storagePlans.codes.revokeConfirm', { code: code.code })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={revokingCode === code.code}
                onClick={() => setRevokeConfirmOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={revokingCode === code.code}
                onClick={() => {
                  onRevoke(code.code)
                  setRevokeConfirmOpen(false)
                }}
              >
                {t('admin.storagePlans.codes.revoke')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.storagePlans.codes.deleteTitle')}</DialogTitle>
              <DialogDescription>{t('admin.storagePlans.codes.deleteConfirm', { code: code.code })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={deletingCode === code.code}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={deletingCode === code.code}
                onClick={() => {
                  onDelete(code.code)
                  setDeleteConfirmOpen(false)
                }}
              >
                {t('admin.storagePlans.codes.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}

function CodeStatusBadge({ code }: { code: StorageRedemptionCode }) {
  const { t } = useTranslation()
  const status = getCodeStatus(code)
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
      {t(`admin.storagePlans.codes.status.${status}`)}
    </Badge>
  )
}

function getCodeStatus(code: StorageRedemptionCode) {
  const expired = code.expiresAt ? new Date(code.expiresAt).getTime() <= Date.now() : false
  if (code.revokedAt) return 'revoked'
  if (expired) return 'expired'
  if (code.usesCount >= code.maxUses) return 'redeemed'
  return 'active'
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
