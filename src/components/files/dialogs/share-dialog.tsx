import { DirType } from '@shared/constants'
import type { CreateShareRequest } from '@shared/schemas'
import type { StorageObject } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Copy, File, Folder, KeyRound, Share2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useClipboard } from '@/hooks/use-clipboard'
import { type CreateShareResult, createShare } from '@/lib/api'
import { formatSize } from '@/lib/format'

interface RecipientChip {
  id: string
  value: string
  valid: boolean
}

interface ShareDialogProps {
  open: boolean
  item: StorageObject | null
  onOpenChange: (open: boolean) => void
  onViewShares?: () => void
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function genPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function addDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

export function buildShareUrl(result: CreateShareResult, origin: string): string {
  const rawPath = result.urls.landing ?? result.urls.direct ?? ''
  return `${origin}${rawPath}`
}

export function isCustomLimitInvalid(option: string, value: string): boolean {
  if (option !== 'custom') return false
  const n = Number.parseInt(value, 10)
  return !value || Number.isNaN(n) || n < 1
}

type ShareMode = 'page' | 'direct' | 'targeted'

function modeToKind(mode: ShareMode): 'landing' | 'direct' {
  return mode === 'direct' ? 'direct' : 'landing'
}

function isTargetedMode(mode: ShareMode): boolean {
  return mode === 'targeted'
}

export function ShareDialog({ open, item, onOpenChange, onViewShares }: ShareDialogProps) {
  const { t } = useTranslation()
  const { copy } = useClipboard()
  const isFolder = item?.dirtype !== DirType.FILE

  const [mode, setMode] = useState<ShareMode>('page')
  const [chips, setChips] = useState<RecipientChip[]>([])
  const [chipInput, setChipInput] = useState('')
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [expiresOption, setExpiresOption] = useState('7d')
  const [customExpires, setCustomExpires] = useState('')
  const [limitOption, setLimitOption] = useState('unlimited')
  const [customLimit, setCustomLimit] = useState('')
  const [result, setResult] = useState<CreateShareResult | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('page')
    setChips([])
    setChipInput('')
    setPasswordEnabled(false)
    setPassword('')
    setExpiresOption('7d')
    setCustomExpires('')
    setLimitOption('unlimited')
    setCustomLimit('')
    setResult(null)
  }, [open])

  function handlePasswordToggle(enabled: boolean) {
    setPasswordEnabled(enabled)
    setPassword(enabled ? genPassword() : '')
  }

  function addChip(raw: string) {
    const value = raw.trim()
    if (!value) return
    setChips((prev) => [...prev, { id: crypto.randomUUID(), value, valid: EMAIL_RE.test(value) }])
    setChipInput('')
  }

  function handleChipKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addChip(chipInput)
    } else if (e.key === 'Backspace' && !chipInput && chips.length > 0) {
      setChips((prev) => prev.slice(0, -1))
    }
  }

  const hasInvalidChips = chips.some((c) => !c.valid)
  const hasValidRecipients = chips.some((c) => c.valid)
  const customExpiresInvalid = expiresOption === 'custom' && (!customExpires || new Date(customExpires) <= new Date())
  const customLimitInvalid = isCustomLimitInvalid(limitOption, customLimit)
  const missingRecipients = isTargetedMode(mode) && !hasValidRecipients
  const canSubmit = !hasInvalidChips && !customExpiresInvalid && !customLimitInvalid && !missingRecipients

  const mutation = useMutation({
    mutationFn: createShare,
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(err instanceof Error ? err.message : t('common.error')),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item || !canSubmit) return
    const kind = modeToKind(mode)
    const body: CreateShareRequest = { matterId: item.id, kind }
    if (mode === 'page' && passwordEnabled && password) body.password = password
    if (expiresOption !== 'never') {
      const days: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }
      body.expiresAt = expiresOption === 'custom' ? new Date(customExpires).toISOString() : addDays(days[expiresOption])
    }
    if (limitOption !== 'unlimited') {
      body.downloadLimit = Number.parseInt(limitOption === 'custom' ? customLimit : limitOption, 10)
    }
    if (isTargetedMode(mode) && chips.length > 0) {
      body.recipients = chips.filter((c) => c.valid).map((c) => ({ recipientEmail: c.value }))
    }
    mutation.mutate(body)
  }

  function copyUrl(url: string) {
    copy(url, 'share.urlCopied')
  }

  if (!item) return null

  const shareUrl = result ? buildShareUrl(result, window.location.origin) : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-2rem))] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('share.title', { name: item.name })}</DialogTitle>
        </DialogHeader>

        {result ? (
          <SuccessView
            mode={mode}
            result={result}
            url={shareUrl}
            password={mode === 'page' && passwordEnabled ? password : undefined}
            recipientCount={chips.filter((c) => c.valid).length}
            onCopy={copyUrl}
            onClose={() => onOpenChange(false)}
            onViewShares={onViewShares}
          />
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <FilePreview item={item} />
              <KindSelector
                mode={mode}
                isFolder={isFolder}
                onChange={(next) => {
                  setMode(next)
                  setPasswordEnabled(false)
                  setPassword('')
                  if (!isTargetedMode(next)) {
                    setChips([])
                    setChipInput('')
                  }
                  setExpiresOption(next === 'direct' ? 'never' : '7d')
                }}
              />

              {mode === 'direct' && (
                <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('share.directWarning')}</span>
                </div>
              )}

              {mode === 'targeted' && (
                <RecipientsField
                  chips={chips}
                  input={chipInput}
                  onInputChange={setChipInput}
                  onKeyDown={handleChipKeyDown}
                  onBlur={() => addChip(chipInput)}
                  onRemove={(id) => setChips((p) => p.filter((c) => c.id !== id))}
                />
              )}

              {mode === 'page' && (
                <>
                  <PasswordField enabled={passwordEnabled} onToggle={handlePasswordToggle} />
                </>
              )}

              <ExpiresField
                option={expiresOption}
                customValue={customExpires}
                onOptionChange={setExpiresOption}
                onCustomChange={setCustomExpires}
              />
              <LimitField
                option={limitOption}
                customValue={customLimit}
                onOptionChange={setLimitOption}
                onCustomChange={setCustomLimit}
              />
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit || mutation.isPending}>
                {mutation.isPending ? t('share.creating') : t('share.createButton')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FilePreview({ item }: { item: StorageObject }) {
  const isFolder = item.dirtype !== DirType.FILE
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      {isFolder ? (
        <Folder className="h-5 w-5 text-muted-foreground" />
      ) : (
        <File className="h-5 w-5 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{item.name}</p>
        {!isFolder && <p className="text-xs text-muted-foreground">{formatSize(item.size)}</p>}
      </div>
    </div>
  )
}

function KindSelector({
  mode,
  isFolder,
  onChange,
}: {
  mode: ShareMode
  isFolder: boolean
  onChange: (v: ShareMode) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <Label>{t('share.modeLabel')}</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onChange('page')}
          className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${mode === 'page' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
        >
          <div className="font-medium">
            <Share2 className="mr-1 inline h-3.5 w-3.5" />
            {t('share.typePage')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t('share.typePageDesc')}</div>
        </button>
        <button
          type="button"
          onClick={() => onChange('targeted')}
          className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${mode === 'targeted' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
        >
          <div className="font-medium">
            <Share2 className="mr-1 inline h-3.5 w-3.5" />
            {t('share.typeTargeted')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t('share.typeTargetedDesc')}</div>
        </button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={isFolder}
                onClick={() => !isFolder && onChange('direct')}
                className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${mode === 'direct' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'} ${isFolder ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <div className="font-medium">
                  <Copy className="mr-1 inline h-3.5 w-3.5" />
                  {t('share.typeDirect')}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t('share.typeDirectDesc')}</div>
              </button>
            </TooltipTrigger>
            {isFolder && <TooltipContent>{t('share.typeDirectFolderTooltip')}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}

function RecipientsField({
  chips,
  input,
  onInputChange,
  onKeyDown,
  onBlur,
  onRemove,
}: {
  chips: RecipientChip[]
  input: string
  onInputChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label>{t('share.recipients')}</Label>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input px-2 py-1 focus-within:ring-1 focus-within:ring-ring">
        {chips.map((c) => (
          <span
            key={c.id}
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs ${c.valid ? 'bg-secondary' : 'border border-destructive bg-destructive/10 text-destructive'}`}
          >
            {c.value}
            <button type="button" onClick={() => onRemove(c.id)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={chips.length === 0 ? t('share.recipientsPlaceholder') : ''}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('share.recipientsHint')}</p>
    </div>
  )
}

function PasswordField({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="share-pwd">{t('share.password')}</Label>
        </div>
        <Switch id="share-pwd" checked={enabled} onCheckedChange={onToggle} />
      </div>
      <p className="text-xs text-muted-foreground">{t('share.passwordHint')}</p>
    </div>
  )
}

function ExpiresField({
  option,
  customValue,
  onOptionChange,
  onCustomChange,
}: {
  option: string
  customValue: string
  onOptionChange: (v: string) => void
  onCustomChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-1.5">
      <Label>{t('share.expires')}</Label>
      <Select value={option} onValueChange={onOptionChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1d">{t('share.expires1d')}</SelectItem>
          <SelectItem value="7d">{t('share.expires7d')}</SelectItem>
          <SelectItem value="30d">{t('share.expires30d')}</SelectItem>
          <SelectItem value="never">{t('share.expiresNever')}</SelectItem>
          <SelectItem value="custom">{t('share.expiresCustom')}</SelectItem>
        </SelectContent>
      </Select>
      {option === 'custom' && (
        <Input type="date" min={today} value={customValue} onChange={(e) => onCustomChange(e.target.value)} />
      )}
    </div>
  )
}

function LimitField({
  option,
  customValue,
  onOptionChange,
  onCustomChange,
}: {
  option: string
  customValue: string
  onOptionChange: (v: string) => void
  onCustomChange: (v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label>{t('share.downloadLimit')}</Label>
      <Select value={option} onValueChange={onOptionChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unlimited">{t('share.limitUnlimited')}</SelectItem>
          <SelectItem value="10">{t('share.limit10')}</SelectItem>
          <SelectItem value="100">{t('share.limit100')}</SelectItem>
          <SelectItem value="custom">{t('share.limitCustom')}</SelectItem>
        </SelectContent>
      </Select>
      {option === 'custom' && (
        <Input
          type="number"
          min={1}
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="1"
        />
      )}
    </div>
  )
}

function SuccessView({
  mode,
  result,
  url,
  password,
  recipientCount,
  onCopy,
  onClose,
  onViewShares,
}: {
  mode: ShareMode
  result: CreateShareResult
  url: string
  password?: string
  recipientCount: number
  onCopy: (url: string) => void
  onClose: () => void
  onViewShares?: () => void
}) {
  const { t } = useTranslation()
  const { copy } = useClipboard()
  const isDirect = result.kind === 'direct'
  const isTargeted = mode === 'targeted'
  const urlLabel = isDirect ? t('share.directUrl') : t('share.pageUrl')
  const successTitle = isTargeted ? t('share.successTargetedTitle') : t('share.successTitle')

  function copyShareText() {
    const text = t('share.shareTextTemplate', { url, password })
    copy(text, 'share.textCopied')
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-5 w-5" />
        <span className="font-medium">{successTitle}</span>
      </div>

      <div className="space-y-2 rounded-md border bg-muted/40 p-3">
        <p className="text-xs font-medium text-muted-foreground">{urlLabel}</p>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs font-mono">{url}</span>
          <Button size="sm" variant="outline" type="button" onClick={() => onCopy(url)}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t('share.copyUrl')}
          </Button>
        </div>
        {isDirect && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            <TriangleAlert className="mr-1 inline h-3 w-3" />
            {t('share.directUrlWarning')}
          </p>
        )}
      </div>

      {password && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{t('share.passwordLabel')}</p>
            <Button size="sm" variant="outline" type="button" className="h-7 text-xs" onClick={copyShareText}>
              <Copy className="mr-1 h-3 w-3" />
              {t('share.copyShareText')}
            </Button>
          </div>
          <span className="block rounded bg-background px-2 py-1 font-mono text-sm tracking-wider">{password}</span>
          <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            {t('share.passwordOnce')}
          </p>
        </div>
      )}

      <div className="space-y-1 text-sm">
        {recipientCount > 0 && (
          <p className="text-muted-foreground">✓ {t('share.addedRecipients', { count: recipientCount })}</p>
        )}
        {result.expiresAt && (
          <p className="text-muted-foreground">
            ✓ {t('share.expiresOn', { date: new Date(result.expiresAt).toLocaleDateString() })}
          </p>
        )}
        {result.downloadLimit != null && (
          <p className="text-muted-foreground">✓ {t('share.limitedDownloads', { count: result.downloadLimit })}</p>
        )}
      </div>

      <div className="mt-auto flex gap-2">
        {onViewShares && (
          <Button variant="outline" type="button" className="flex-1" onClick={onViewShares}>
            {t('share.viewMyShares')}
          </Button>
        )}
        <Button type="button" className="flex-1" onClick={onClose}>
          {t('share.done')}
        </Button>
      </div>
    </div>
  )
}
