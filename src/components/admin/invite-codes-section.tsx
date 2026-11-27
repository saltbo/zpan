import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Copy, Ticket, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { ConfirmActionDialog } from '@/components/admin/confirm-action-dialog'
import { CursorPagination } from '@/components/list/cursor-pagination'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCursorPager } from '@/hooks/use-cursor-pager'
import { deleteInviteCode, generateInviteCodes, type InviteCode, listInviteCodes } from '@/lib/api'

const inviteCodesQueryKey = ['admin', 'invite-codes'] as const
const PAGE_SIZE_OPTIONS = [20, 50, 100]

type CodeStatus = 'used' | 'expired' | 'available'

function codeStatus(code: InviteCode): CodeStatus {
  if (code.usedBy) return 'used'
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return 'expired'
  return 'available'
}

function StatusBadge({ status }: { status: CodeStatus }) {
  const { t } = useTranslation()
  const labels = {
    available: t('admin.auth.statusAvailable'),
    used: t('admin.auth.statusUsed'),
    expired: t('admin.auth.statusExpired'),
  }
  return <Badge variant={status === 'available' ? 'outline' : 'secondary'}>{labels[status]}</Badge>
}

function RowAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function InviteCodesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [count, setCount] = useState(10)
  const [expiresInDays, setExpiresInDays] = useState('')
  const [pendingDelete, setPendingDelete] = useState<InviteCode | null>(null)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const pager = useCursorPager(String(pageSize))

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [...inviteCodesQueryKey, pageSize, pager.pageToken],
    queryFn: () => listInviteCodes({ pageToken: pager.pageToken, pageSize }),
    placeholderData: keepPreviousData,
  })

  const generateMutation = useMutation({
    mutationFn: () => generateInviteCodes(count, expiresInDays ? Number(expiresInDays) : undefined),
    onSuccess: () => {
      pager.reset()
      queryClient.invalidateQueries({ queryKey: inviteCodesQueryKey })
      toast.success(t('admin.auth.codesGenerated'))
      setDrawerOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteInviteCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteCodesQueryKey })
      toast.success(t('admin.auth.codeDeleted'))
      setPendingDelete(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => toast.success(t('admin.auth.codeCopied')),
      () => toast.error(t('common.error')),
    )
  }

  const codes = data?.items ?? []
  const hasCodes = codes.length > 0 || pager.hasPrevious
  const generateButton = (
    <Button size="sm" onClick={() => setDrawerOpen(true)}>
      {t('admin.auth.generateCodes')}
    </Button>
  )

  return (
    <Card data-settings-row className="min-w-0 gap-0 rounded-lg border-border/70 py-0 shadow-xs">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
            <Ticket className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm leading-5">{t('admin.auth.inviteCodesSection')}</CardTitle>
            <CardDescription className="max-w-2xl leading-5">{t('admin.auth.inviteCodesDescription')}</CardDescription>
          </div>
        </div>
        {hasCodes && <div className="flex shrink-0 items-center">{generateButton}</div>}
      </CardContent>

      <CardContent className="border-t border-border/70 p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : isError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>{t('admin.auth.inviteCodesLoadFailed')}</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => refetch()}>
                {t('admin.overview.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : !hasCodes ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm font-medium">{t('admin.auth.noInviteCodes')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.auth.noInviteCodesHint')}</p>
            <div className="pt-2">{generateButton}</div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.auth.colCode')}</TableHead>
                <TableHead>{t('admin.auth.colStatus')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('admin.auth.colUsedBy')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('admin.auth.colExpiresAt')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('admin.auth.colCreatedAt')}</TableHead>
                <TableHead className="text-right">{t('admin.auth.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((code) => {
                const status = codeStatus(code)
                return (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono text-sm">{code.code}</TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell
                      className="hidden max-w-40 truncate text-sm lg:table-cell"
                      title={code.usedBy ?? undefined}
                    >
                      {code.usedBy ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {new Date(code.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <RowAction label={t('admin.auth.copyCode')} onClick={() => copyToClipboard(code.code)}>
                          <Copy />
                        </RowAction>
                        {status === 'available' && (
                          <RowAction
                            label={t('common.delete')}
                            onClick={() => setPendingDelete(code)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 />
                          </RowAction>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {hasCodes && !isError && (
          <div className="mt-4">
            <CursorPagination
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              hasPrevious={pager.hasPrevious}
              nextPageToken={data?.nextPageToken}
              disabled={isFetching}
              onPageSizeChange={setPageSize}
              onPrevious={pager.previous}
              onNext={pager.next}
            />
          </div>
        )}
      </CardContent>

      <AdminFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t('admin.auth.generateTitle')}
        description={t('admin.auth.inviteCodesDescription')}
        bodyClassName="grid auto-rows-min content-start gap-4"
        formProps={{
          onSubmit: (event) => {
            event.preventDefault()
            generateMutation.mutate()
          },
        }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDrawerOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={generateMutation.isPending}>
              {generateMutation.isPending ? t('common.loading') : t('common.create')}
            </Button>
          </>
        }
      >
        <AdminFormField id="invite-code-count" label={t('admin.auth.codeCount')} required>
          <Input
            type="number"
            min={1}
            max={100}
            placeholder="10"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </AdminFormField>
        <AdminFormField
          id="invite-code-expires"
          label={t('admin.auth.expiresInDays')}
          help={t('admin.auth.expiresInDaysHint')}
        >
          <Input
            type="number"
            min={1}
            placeholder="30"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </AdminFormField>
      </AdminFormDrawer>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('admin.auth.deleteCodeTitle', { code: pendingDelete?.code ?? '' })}
        description={t('admin.auth.deleteCodeConfirm')}
        confirmLabel={t('common.delete')}
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
        }}
      />
    </Card>
  )
}
