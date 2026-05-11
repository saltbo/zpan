import type { CreateGiftCardInput, GiftCardStatus } from '@shared/schemas'
import type { CloudGiftCard } from '@shared/types'
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
import { formatMoney } from '@/lib/format'

export const emptyGiftCardForm = {
  amount: '10',
  currency: 'usd',
  expiresAt: '',
  count: '1',
}
export type GiftCardFormState = typeof emptyGiftCardForm

export function giftCardInputFromForm(form: GiftCardFormState): CreateGiftCardInput {
  const input: CreateGiftCardInput = {
    amount: Math.round(Number(form.amount) * 100),
    currency: form.currency.trim().toLowerCase(),
    count: Math.round(Number(form.count)),
  }
  if (form.expiresAt) input.expiresAt = new Date(form.expiresAt).toISOString()
  return input
}

export function StorageGiftCardPanel(props: CodeGenerateFormProps & CodeListProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <CodeToolbar {...props} />
      <div className="space-y-2">
        <CodeTable {...props} />
        {props.codes.length === 0 && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('admin.cloudStore.codes.empty')}
          </div>
        )}
      </div>
    </div>
  )
}

type CodeGenerateFormProps = {
  form: GiftCardFormState
  available: boolean
  pending: boolean
  onFormChange: (form: GiftCardFormState) => void
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
          {t('admin.cloudStore.codes.generateTitle')}
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
          <DialogTitle>{t('admin.cloudStore.codes.generateTitle')}</DialogTitle>
          <DialogDescription>{t('admin.cloudStore.codes.generateDescription')}</DialogDescription>
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
      <NumberField
        id="giftCardAmount"
        label={t('admin.cloudStore.codes.amount')}
        value={form.amount}
        onChange={(amount) => onFormChange({ ...form, amount })}
      />
      <Field label={t('admin.cloudStore.codes.currency')} htmlFor="giftCardCurrency">
        <Select value={form.currency} onValueChange={(currency) => onFormChange({ ...form, currency })}>
          <SelectTrigger id="giftCardCurrency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="usd">USD</SelectItem>
            <SelectItem value="cny">CNY</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <DateField value={form.expiresAt} onChange={(expiresAt) => onFormChange({ ...form, expiresAt })} />
      <NumberField
        id="codeCount"
        label={t('admin.cloudStore.codes.count')}
        value={form.count}
        max="100"
        onChange={(count) => onFormChange({ ...form, count })}
      />
      <Button className="w-full" disabled={!available || pending} onClick={onGenerate}>
        <Plus className="mr-2 h-4 w-4" />
        {t('admin.cloudStore.codes.generate')}
      </Button>
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
    <Field label={t('admin.cloudStore.codes.expiresAt')} htmlFor="codeExpiresAt">
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
  codes: CloudGiftCard[]
  status: GiftCardStatus | 'all'
  available: boolean
  disablingGiftCard: string | null
  deletingGiftCard: string | null
  onStatusChange: (status: GiftCardStatus | 'all') => void
  onRevoke: (code: string) => void
  onDelete: (code: string) => void
}

function CodeStatusSelect({ status, onStatusChange }: Pick<CodeListProps, 'status' | 'onStatusChange'>) {
  const { t } = useTranslation()
  return (
    <Select value={status} onValueChange={(value: GiftCardStatus | 'all') => onStatusChange(value)}>
      <SelectTrigger className="h-9 w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(['all', 'active', 'redeemed', 'disabled', 'expired', 'revoked'] as const).map((value) => (
          <SelectItem key={value} value={value}>
            {t(`admin.cloudStore.codes.status.${value}`)}
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
            {['code', 'storage', 'expires', 'statusLabel'].map((key) => (
              <TableHead key={key}>{t(`admin.cloudStore.codes.${key}`)}</TableHead>
            ))}
            <TableHead className="text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.codes.map((code) => (
            <CodeRow key={code.id} code={code} {...props} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CodeRow({
  code,
  available,
  disablingGiftCard,
  deletingGiftCard,
  onRevoke,
  onDelete,
}: CodeListProps & { code: CloudGiftCard }) {
  const { t } = useTranslation()
  const [disableConfirmOpen, setRevokeConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const actionTarget = code.code ?? code.id
  const codeLabel = code.code ?? code.codeLast4
  const canDisable = code.status === 'active'
  const canDelete = code.status === 'active'
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{codeLabel}</TableCell>
      <TableCell>{formatMoney(code.amount, code.currency)}</TableCell>
      <TableCell>{code.expiresAt ? new Date(code.expiresAt).toLocaleString() : '-'}</TableCell>
      <TableCell>
        <CodeStatusBadge code={code} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!available || !canDisable || disablingGiftCard === actionTarget}
            onClick={() => setRevokeConfirmOpen(true)}
          >
            <Ban className="mr-2 h-4 w-4" />
            {t('admin.cloudStore.codes.disable')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!available || !canDelete || deletingGiftCard === actionTarget}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('admin.cloudStore.codes.delete')}
          </Button>
        </div>
        <Dialog open={disableConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.cloudStore.codes.disableTitle')}</DialogTitle>
              <DialogDescription>{t('admin.cloudStore.codes.disableConfirm', { code: codeLabel })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={disablingGiftCard === actionTarget}
                onClick={() => setRevokeConfirmOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={disablingGiftCard === actionTarget}
                onClick={() => {
                  onRevoke(actionTarget)
                  setRevokeConfirmOpen(false)
                }}
              >
                {t('admin.cloudStore.codes.disable')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('admin.cloudStore.codes.deleteTitle')}</DialogTitle>
              <DialogDescription>{t('admin.cloudStore.codes.deleteConfirm', { code: codeLabel })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={deletingGiftCard === actionTarget}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={deletingGiftCard === actionTarget}
                onClick={() => {
                  onDelete(actionTarget)
                  setDeleteConfirmOpen(false)
                }}
              >
                {t('admin.cloudStore.codes.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}

function CodeStatusBadge({ code }: { code: CloudGiftCard }) {
  const { t } = useTranslation()
  const status = getCodeStatus(code)
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'}>
      {t(`admin.cloudStore.codes.status.${status}`)}
    </Badge>
  )
}

function getCodeStatus(code: CloudGiftCard) {
  return code.status
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
