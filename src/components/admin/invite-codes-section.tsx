import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deleteInviteCode, generateInviteCodes, type InviteCode, listInviteCodes } from '@/lib/api'

const inviteCodesQueryKey = ['admin', 'invite-codes'] as const

function codeStatus(code: InviteCode): 'used' | 'expired' | 'available' {
  if (code.usedBy) return 'used'
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return 'expired'
  return 'available'
}

function StatusBadge({ status }: { status: 'used' | 'expired' | 'available' }) {
  const { t } = useTranslation()
  const colors = {
    available: 'bg-green-100 text-green-800',
    used: 'bg-gray-100 text-gray-800',
    expired: 'bg-red-100 text-red-800',
  }
  const labels = {
    available: t('admin.auth.statusAvailable'),
    used: t('admin.auth.statusUsed'),
    expired: t('admin.auth.statusExpired'),
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[status]}`}>{labels[status]}</span>
  )
}

export function InviteCodesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [count, setCount] = useState(10)
  const [expiresInDays, setExpiresInDays] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: inviteCodesQueryKey,
    queryFn: () => listInviteCodes(1, 100),
  })

  const generateMutation = useMutation({
    mutationFn: () => generateInviteCodes(count, expiresInDays ? Number(expiresInDays) : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteCodesQueryKey })
      toast.success(t('admin.auth.codesGenerated'))
      setDialogOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteInviteCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteCodesQueryKey })
      toast.success(t('admin.auth.codeDeleted'))
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

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.inviteCodesSection')}</h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {t('admin.auth.generateCodes')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.auth.noInviteCodes')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.auth.colCode')}</TableHead>
              <TableHead>{t('admin.auth.colStatus')}</TableHead>
              <TableHead>{t('admin.auth.colUsedBy')}</TableHead>
              <TableHead>{t('admin.auth.colExpiresAt')}</TableHead>
              <TableHead>{t('admin.auth.colCreatedAt')}</TableHead>
              <TableHead>{t('admin.auth.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.map((code) => {
              const status = codeStatus(code)
              return (
                <TableRow key={code.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(code.code)}
                      className="font-mono text-sm hover:underline cursor-pointer"
                    >
                      {code.code}
                    </button>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                  <TableCell className="text-sm">{code.usedBy ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{new Date(code.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {status === 'available' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(code.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.auth.generateTitle')}</DialogTitle>
            <DialogDescription>{t('admin.auth.expiresInDaysHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('admin.auth.codeCount')}</Label>
              <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.expiresInDays')}</Label>
              <Input
                type="number"
                min={1}
                placeholder={t('admin.auth.expiresInDaysHint')}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? t('common.loading') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
