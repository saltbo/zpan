import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Search, ShieldCheck, Trash2, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { DeleteUserDialog } from '@/components/admin/delete-user-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listUsers, type UserWithOrg, updateUserStatus } from '@/lib/api'
import { formatDate, formatSize, getInitials } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/users/')({
  component: UsersPage,
})

type UserRow = UserWithOrg

function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [deleteDialogUser, setDeleteDialogUser] = useState<{ id: string; name: string } | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page, pageSize],
    queryFn: () => listUsers(page, pageSize),
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

  const users: UserRow[] = useMemo(() => {
    return usersQuery.data?.items ?? []
  }, [usersQuery.data])

  const filtered = useMemo(() => {
    if (!search.trim()) return users
    const term = search.toLowerCase()
    return users.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
  }, [users, search])

  const total = usersQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isLoading = usersQuery.isLoading

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value)
    setPage(1)
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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('admin.users.title')}</h2>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('admin.users.searchPlaceholder')}
            value={search}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-[23%] px-4 py-3 text-left font-medium">{t('admin.users.colName')}</th>
              <th className="w-[25%] px-4 py-3 text-left font-medium">{t('admin.users.colEmail')}</th>
              <th className="w-[9%] px-4 py-3 text-left font-medium">{t('admin.users.colRole')}</th>
              <th className="w-[10%] px-4 py-3 text-left font-medium">{t('admin.users.colStatus')}</th>
              <th className="w-[14%] px-4 py-3 text-left font-medium">{t('admin.users.colQuota')}</th>
              <th className="w-[11%] truncate px-4 py-3 text-left font-medium">{t('admin.users.colCreatedAt')}</th>
              <th className="w-[8%] px-4 py-3 text-right font-medium">{t('admin.users.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <UserTableRow
                key={user.id}
                user={user}
                isToggling={toggleStatusMutation.isPending}
                onOpenUser={() => navigate({ to: '/admin/users/$userId', params: { userId: user.id } })}
                onToggleStatus={() =>
                  toggleStatusMutation.mutate({
                    userId: user.id,
                    status: user.banned ? 'active' : 'disabled',
                  })
                }
                onDelete={() => setDeleteDialogUser({ id: user.id, name: user.name })}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t('admin.users.noUsers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.users.prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('admin.users.pageInfo', { page, total: totalPages })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t('admin.users.nextPage')}
          </Button>
        </div>
      )}

      <DeleteUserDialog
        open={deleteDialogUser !== null}
        onOpenChange={(open) => !open && setDeleteDialogUser(null)}
        user={deleteDialogUser}
      />
    </div>
  )
}

function UserTableRow({
  user,
  isToggling,
  onOpenUser,
  onToggleStatus,
  onDelete,
}: {
  user: UserRow
  isToggling: boolean
  onOpenUser: () => void
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
      <td className="px-4 py-3 font-medium">
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 text-left hover:text-primary"
          onClick={onOpenUser}
        >
          <Avatar className="h-7 w-7 shrink-0">
            {user.image && <AvatarImage src={user.image} alt={user.name || user.username} />}
            <AvatarFallback className="text-xs">{getInitials(user.name || user.username || user.email)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate" title={user.name || user.username}>
            {user.name || user.username}
          </span>
        </button>
      </td>
      <td className="truncate px-4 py-3 text-muted-foreground" title={user.email}>
        {user.email}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge}`}>{roleLabel}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}>
          {user.banned ? t('admin.users.disabled') : t('admin.users.active')}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{quotaLabel}</td>
      <td className="truncate px-4 py-3 text-muted-foreground" title={formatDate(user.createdAt)}>
        {formatDate(user.createdAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center justify-end gap-1">
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

function formatQuota(used: number, total: number): string {
  if (total <= 0) return `${formatSize(used)} / --`
  return `${formatSize(used)} / ${formatSize(total)}`
}
