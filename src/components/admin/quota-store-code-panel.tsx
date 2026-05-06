import type { GenerateStorageCodesInput, StorageCodeStatus } from '@shared/schemas'
import type { StorageRedemptionCode } from '@shared/types'
import { Ban, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/format'

const units = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof units

export const emptyCodeForm = { size: '100', unit: 'GB' as Unit, maxUses: '1', expiresAt: '', count: '1' }
export type CodeFormState = typeof emptyCodeForm

export function codeInputFromForm(form: CodeFormState): GenerateStorageCodesInput {
  const input: GenerateStorageCodesInput = {
    bytes: Math.round(Number(form.size) * units[form.unit]),
    maxUses: Math.round(Number(form.maxUses)),
    count: Math.round(Number(form.count)),
  }
  if (form.expiresAt) input.expiresAt = new Date(form.expiresAt).toISOString()
  return input
}

export function QuotaStoreCodePanel(props: CodeGenerateFormProps & CodeListProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <CodeGenerateForm {...props} />
      <CodeList {...props} />
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

function CodeGenerateForm({ form, available, pending, onFormChange, onGenerate }: CodeGenerateFormProps) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('admin.quotaStore.codes.generateTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SizeFields form={form} onFormChange={onFormChange} />
        <NumberField
          id="codeMaxUses"
          label={t('admin.quotaStore.codes.maxUses')}
          value={form.maxUses}
          onChange={(maxUses) => onFormChange({ ...form, maxUses })}
        />
        <DateField value={form.expiresAt} onChange={(expiresAt) => onFormChange({ ...form, expiresAt })} />
        <NumberField
          id="codeCount"
          label={t('admin.quotaStore.codes.count')}
          value={form.count}
          max="100"
          onChange={(count) => onFormChange({ ...form, count })}
        />
        <Button className="w-full" disabled={!available || pending} onClick={onGenerate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.quotaStore.codes.generate')}
        </Button>
      </CardContent>
    </Card>
  )
}

function SizeFields({ form, onFormChange }: { form: CodeFormState; onFormChange: (form: CodeFormState) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_96px] gap-2">
      <NumberField
        id="codeSize"
        label={t('admin.quotaStore.size')}
        value={form.size}
        onChange={(size) => onFormChange({ ...form, size })}
      />
      <Field label={t('admin.quotaStore.unit')}>
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
    <Field label={t('admin.quotaStore.codes.expiresAt')} htmlFor="codeExpiresAt">
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
  onStatusChange: (status: StorageCodeStatus | 'all') => void
  onRevoke: (code: string) => void
}

function CodeList(props: CodeListProps) {
  return (
    <div className="space-y-3">
      <CodeListToolbar status={props.status} onStatusChange={props.onStatusChange} />
      <CodeTable {...props} />
      {props.codes.length === 0 && <CodeEmptyState />}
    </div>
  )
}

function CodeListToolbar({ status, onStatusChange }: Pick<CodeListProps, 'status' | 'onStatusChange'>) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">{t('admin.quotaStore.codes.listTitle')}</h3>
      <Select value={status} onValueChange={(value: StorageCodeStatus | 'all') => onStatusChange(value)}>
        <SelectTrigger className="h-9 w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['all', 'active', 'redeemed', 'expired'] as const).map((value) => (
            <SelectItem key={value} value={value}>
              {t(`admin.quotaStore.codes.status.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
              <TableHead key={key}>{t(`admin.quotaStore.codes.${key}`)}</TableHead>
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

function CodeRow({ code, available, revokingCode, onRevoke }: CodeListProps & { code: StorageRedemptionCode }) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{code.code}</TableCell>
      <TableCell>{formatSize(code.bytes)}</TableCell>
      <TableCell>
        {code.usesCount}/{code.maxUses}
      </TableCell>
      <TableCell>{code.expiresAt ? new Date(code.expiresAt).toLocaleString() : '-'}</TableCell>
      <TableCell>
        <CodeStatusBadge code={code} />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="outline"
          size="sm"
          disabled={!available || Boolean(code.revokedAt) || revokingCode === code.code}
          onClick={() => onRevoke(code.code)}
        >
          <Ban className="mr-2 h-4 w-4" />
          {t('admin.quotaStore.codes.revoke')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function CodeStatusBadge({ code }: { code: StorageRedemptionCode }) {
  const { t } = useTranslation()
  const status = getCodeStatus(code)
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
      {t(`admin.quotaStore.codes.status.${status}`)}
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

function CodeEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {t('admin.quotaStore.codes.empty')}
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
