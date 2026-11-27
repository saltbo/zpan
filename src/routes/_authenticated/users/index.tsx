import type { AdminUserListItem } from '@shared/types'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Search, ShieldCheck, UserX } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUrlText } from '@/hooks/use-url-text'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { getUserQuotaById, listUsers } from '@/lib/api'
import { adminSetUserBanned } from '@/lib/auth-client'
import { formatDate, formatSize, getInitials } from '@/lib/format'
import { textParam } from '@/lib/list-search'

export const usersSearchSchema = z.object({ q: textParam })

export const Route = createFileRoute('/_authenticated/users/')({
  validateSearch: usersSearchSchema,
  component: UsersPage,
})

type UserRow = AdminUserListItem & { quotaUsed: number; quotaTotal: number }

export function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listSearch = useSearch({ from: '/_authenticated/users/' })
  const search = listSearch.q ?? ''
  const [searchText, setSearchText] = useUrlText(search, (q) =>
    navigate({ to: '/users', search: { q: q || undefined }, replace: true }),
  )
  const pageSize = 20

  const usersQuery = useInfiniteQuery({
    queryKey: ['admin', 'users', 'directory', pageSize, search.trim()],
    queryFn: ({ pageParam }) => listUsers({ pageToken: pageParam, pageSize, search }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    placeholderData: keepPreviousData,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: usersQuery.hasNextPage,
    isFetchingNextPage: usersQuery.isFetchingNextPage,
    fetchNextPage: usersQuery.fetchNextPage,
  })

  const baseUsers = useMemo(() => usersQuery.data?.pages.flatMap((page) => page.items) ?? [], [usersQuery.data])

  const quotaQuery = useQuery({
    queryKey: ['admin', 'user-quotas', baseUsers.map((u) => u.id)],
    queryFn: async () => {
      const entries = await Promise.all(baseUsers.map(async (u) => [u.id, await getUserQuotaById(u.id)] as const))
      return new Map(entries)
    },
    enabled: baseUsers.length > 0,
  })

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) => adminSetUserBanned(userId, banned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.users.statusUpdated'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const users: UserRow[] = useMemo(() => {
    const quota = quotaQuery.data
    return baseUsers.map((user) => ({
      ...user,
      quotaUsed: quota?.get(user.id)?.used ?? 0,
      quotaTotal: quota?.get(user.id)?.total ?? 0,
    }))
  }, [baseUsers, quotaQuery.data])

  const isLoading = usersQuery.isLoading

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
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
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
            {users.map((user) => (
              <UserTableRow
                key={user.id}
                user={user}
                isToggling={toggleStatusMutation.isPending}
                onOpenUser={() => navigate({ to: '/admin/users/$userId', params: { userId: user.id } })}
                onToggleStatus={() => toggleStatusMutation.mutate({ userId: user.id, banned: !user.banned })}
              />
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t('admin.users.noUsers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {usersQuery.hasNextPage && (
        <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground" role="status">
          {usersQuery.isFetchingNextPage ? t('common.loading') : null}
        </div>
      )}
    </div>
  )
}

function UserTableRow({
  user,
  isToggling,
  onOpenUser,
  onToggleStatus,
}: {
  user: UserRow
  isToggling: boolean
  onOpenUser: () => void
  onToggleStatus: () => void
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
            {user.image && <AvatarImage src={user.image} alt={user.name || user.username || user.email} />}
            <AvatarFallback className="text-xs">{getInitials(user.name || user.username || user.email)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate" title={user.name || user.username || user.email}>
            {user.name || user.username || user.email}
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
        </div>
      </td>
    </tr>
  )
}

function formatQuota(used: number, total: number): string {
  if (total <= 0) return `${formatSize(used)} / --`
  return `${formatSize(used)} / ${formatSize(total)}`
}
