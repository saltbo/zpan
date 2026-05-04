import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Search, Settings2, ShieldCheck, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DeleteUserDialog } from '@/components/admin/delete-user-dialog'
import { SiteInvitationsDialog } from '@/components/admin/site-invitations-dialog'
import { UserQuotaDialog } from '@/components/admin/user-quota-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  batchDeleteUsers,
  batchUpdateUserQuota,
  batchUpdateUserStatus,
  listQuotas,
  listUsers,
  type QuotaItem,
  type UserWithOrg,
  updateUserStatus,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/users/')({
  component: UsersPage,
})

interface UserRow extends UserWithOrg {
  quotaUsed: number
  quotaTotal: number
}

function UsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [quotaDialogUser, setQuotaDialogUser] = useState<UserRow | null>(null)
  const [batchQuotaOpen, setBatchQuotaOpen] = useState(false)
  const [deleteDialogUser, setDeleteDialogUser] = useState<{ id: string; name: string } | null>(null)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page, pageSize, search],
    queryFn: () => listUsers(page, pageSize, search),
  })

  const quotasQuery = useQuery({
    queryKey: ['admin', 'quotas'],
    queryFn: listQuotas,
  })

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'active' | 'disabled' }) =>
      updateUserStatus(userId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.users.statusUpdated'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const batchStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'active' | 'disabled' }) =>
      batchUpdateUserStatus(ids, status),
    onSuccess: (result) => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.users.batchStatusUpdated', { count: result.updated }))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => batchDeleteUsers(ids),
    onSuccess: (result) => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] })
      toast.success(t('admin.users.batchDeleted', { count: result.deleted }))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const batchQuotaMutation = useMutation({
    mutationFn: (quota: number) => batchUpdateUserQuota(selectedIds, quota),
    onSuccess: (result) => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] })
      toast.success(t('admin.users.batchQuotaUpdated', { count: result.updated }))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const quotaMap = useMemo(() => {
    const map = new Map<string, QuotaItem>()
    for (const q of quotasQuery.data?.items ?? []) {
      map.set(q.orgId, q)
    }
    return map
  }, [quotasQuery.data])

  const users: UserRow[] = useMemo(() => {
    const items = usersQuery.data?.items ?? []
    return items.map((u) => {
      const quota = u.orgId ? quotaMap.get(u.orgId) : undefined
      return { ...u, quotaUsed: quota?.used ?? 0, quotaTotal: quota?.quota ?? 0 }
    })
  }, [usersQuery.data, quotaMap])

  const total = usersQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isLoading = usersQuery.isLoading || quotasQuery.isLoading
  const selectedCount = selectedIds.length
  const pageUserIds = users.map((user) => user.id)
  const allPageSelected = pageUserIds.length > 0 && pageUserIds.every((id) => selectedIds.includes(id))
  const batchPending = batchStatusMutation.isPending || batchDeleteMutation.isPending || batchQuotaMutation.isPending

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value)
    setPage(1)
    setSelectedIds([])
  }

  function goToPage(nextPage: number) {
    setPage(nextPage)
    setSelectedIds([])
  }

  function togglePageSelection(checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, ...pageUserIds])] : current.filter((id) => !pageUserIds.includes(id)),
    )
  }

  function toggleUserSelection(userId: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId)))
  }

  function handleBatchDelete() {
    if (selectedCount === 0) return
    if (!window.confirm(t('admin.users.batchDeleteConfirm', { count: selectedCount }))) return
    batchDeleteMutation.mutate(selectedIds)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t('admin.users.title')}</h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('admin.users.searchPlaceholder')}
              value={search}
              onChange={handleSearchChange}
              className="pl-9"
            />
          </div>
          <Button onClick={() => setInviteDialogOpen(true)}>
            <UserPlus />
            {t('admin.users.inviteUser')}
          </Button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium">{t('admin.users.selectedCount', { count: selectedCount })}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={batchPending}
              onClick={() => batchStatusMutation.mutate({ ids: selectedIds, status: 'disabled' })}
            >
              <UserX />
              {t('admin.users.batchDisable')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={batchPending}
              onClick={() => batchStatusMutation.mutate({ ids: selectedIds, status: 'active' })}
            >
              <UserCheck />
              {t('admin.users.batchEnable')}
            </Button>
            <Button variant="outline" size="sm" disabled={batchPending} onClick={() => setBatchQuotaOpen(true)}>
              <Settings2 />
              {t('admin.users.batchSetQuota')}
            </Button>
            <Button variant="destructive" size="sm" disabled={batchPending} onClick={handleBatchDelete}>
              <Trash2 />
              {t('admin.users.batchDelete')}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-10 px-4 py-3 text-left font-medium">
                <Checkbox
                  aria-label={t('admin.users.selectPage')}
                  checked={allPageSelected}
                  onCheckedChange={(checked) => togglePageSelection(checked === true)}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.users.colName')}</th>
              <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">{t('admin.users.colEmail')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.users.colRole')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.users.colStatus')}</th>
              <th className="hidden px-4 py-3 text-left font-medium md:table-cell">{t('admin.users.colQuota')}</th>
              <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">{t('admin.users.colCreatedAt')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.users.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserTableRow
                key={user.id}
                user={user}
                selected={selectedIds.includes(user.id)}
                isToggling={toggleStatusMutation.isPending}
                showQuota
                onSelect={(checked) => toggleUserSelection(user.id, checked)}
                onSetQuota={() => setQuotaDialogUser(user)}
                onToggleStatus={() =>
                  toggleStatusMutation.mutate({
                    userId: user.id,
                    status: user.banned ? 'active' : 'disabled',
                  })
                }
                onDelete={() => setDeleteDialogUser({ id: user.id, name: user.name || user.username })}
              />
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  {t('admin.users.noUsers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            {t('admin.users.prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('admin.users.pageInfo', { page, total: totalPages })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            {t('admin.users.nextPage')}
          </Button>
        </div>
      )}

      <UserQuotaDialog
        open={quotaDialogUser !== null}
        onOpenChange={(open) => !open && setQuotaDialogUser(null)}
        user={
          quotaDialogUser?.orgId
            ? {
                name: quotaDialogUser.name || quotaDialogUser.username,
                orgId: quotaDialogUser.orgId,
                quotaUsed: quotaDialogUser.quotaUsed,
                quotaTotal: quotaDialogUser.quotaTotal,
              }
            : null
        }
      />

      <UserQuotaDialog
        open={batchQuotaOpen}
        onOpenChange={setBatchQuotaOpen}
        user={
          batchQuotaOpen
            ? {
                name: t('admin.users.selectedUsers', { count: selectedCount }),
                orgId: 'batch',
                quotaUsed: 0,
                quotaTotal: 0,
              }
            : null
        }
        onSave={(quota) => batchQuotaMutation.mutateAsync(quota)}
        showSuccessToast={false}
      />

      <DeleteUserDialog
        open={deleteDialogUser !== null}
        onOpenChange={(open) => !open && setDeleteDialogUser(null)}
        user={deleteDialogUser}
      />

      <SiteInvitationsDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />
    </div>
  )
}

function UserTableRow({
  user,
  selected,
  isToggling,
  showQuota,
  onSelect,
  onSetQuota,
  onToggleStatus,
  onDelete,
}: {
  user: UserRow
  selected: boolean
  isToggling: boolean
  showQuota: boolean
  onSelect: (checked: boolean) => void
  onSetQuota: () => void
  onToggleStatus: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const roleBadge = user.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
  const statusBadge = user.banned
    ? 'bg-destructive/10 text-destructive'
    : 'bg-green-500/10 text-green-700 dark:text-green-400'

  const roleLabel = user.role === 'admin' ? t('admin.users.roleAdmin') : t('admin.users.roleMember')
  const quotaLabel = formatQuota(user.quotaUsed, user.quotaTotal)

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <Checkbox
          aria-label={t('admin.users.selectUser', { name: user.name || user.username })}
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
      </td>
      <td className="px-4 py-3 font-medium">{user.name || user.username}</td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{user.email}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge}`}>{roleLabel}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}>
          {user.banned ? t('admin.users.disabled') : t('admin.users.active')}
        </span>
      </td>
      {showQuota && <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{quotaLabel}</td>}
      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(user.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {showQuota && (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!user.orgId}
              onClick={onSetQuota}
              title={t('admin.users.setQuota')}
            >
              <Settings2 />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={isToggling}
            onClick={onToggleStatus}
            title={user.banned ? t('admin.users.enable') : t('admin.users.disable')}
          >
            {user.banned ? <ShieldCheck /> : <UserX />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onDelete} title={t('common.delete')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

const BYTES_PER_GB = 1024 * 1024 * 1024

function formatQuota(used: number, total: number): string {
  const usedGB = (used / BYTES_PER_GB).toFixed(1)
  if (total <= 0) return `${usedGB} GB / --`
  const totalGB = (total / BYTES_PER_GB).toFixed(1)
  return `${usedGB} / ${totalGB} GB`
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
