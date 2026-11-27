import type { AdminUserListItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Search, ShieldCheck, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DeleteUserDialog } from '@/components/admin/delete-user-dialog'
import { InviteUserDrawer } from '@/components/admin/invite-user-drawer'
import { SiteInvitationsList } from '@/components/admin/site-invitations-list'
import { CursorPagination } from '@/components/list/cursor-pagination'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCursorPager, useStepBackFromEmptyPage } from '@/hooks/use-cursor-pager'
import { useUrlText } from '@/hooks/use-url-text'
import { getUserQuotaById, listUsers } from '@/lib/api'
import { adminRemoveUser, adminSetUserBanned } from '@/lib/auth-client'
import { formatDate, formatStorageUsage, getInitials } from '@/lib/format'
import { enumParam, numberOptionParam, textParam } from '@/lib/list-search'

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 20

export const adminUsersSearchSchema = z.object({
  tab: enumParam(['invitations']),
  q: textParam,
  size: numberOptionParam(PAGE_SIZE_OPTIONS),
})

type UsersTab = 'users' | 'invitations'

export const Route = createFileRoute('/_authenticated/admin/users/')({
  validateSearch: adminUsersSearchSchema,
  component: UsersPage,
})

type UserRow = AdminUserListItem & { quotaUsed: number; quotaTotal: number }

export function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listSearch = useSearch({ from: '/_authenticated/admin/users/' })
  const search = listSearch.q ?? ''
  const pageSize = listSearch.size ?? DEFAULT_PAGE_SIZE
  const tab: UsersTab = listSearch.tab ?? 'users'
  const [searchText, setSearchText] = useUrlText(search, (q) => updateListSearch({ q, size: pageSize }, true))
  const [inviteDrawerOpen, setInviteDrawerOpen] = useState(false)

  const [deleteDialogUser, setDeleteDialogUser] = useState<{ id: string; name: string } | null>(null)
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const pager = useCursorPager(`${pageSize}:${search}`)

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', pageSize, search, pager.pageToken],
    queryFn: () => listUsers({ pageToken: pager.pageToken, pageSize, search }),
  })
  useStepBackFromEmptyPage({ ...pager, previous: () => movePage(pager.previous) }, usersQuery)

  const baseUsers = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data])
  const pageUserIds = useMemo(() => baseUsers.map((user) => user.id), [baseUsers])

  // better-auth's admin list knows identity but not storage quota — fan out over
  // the per-user quota sub-resource for the visible page and merge the results.
  const quotaQuery = useQuery({
    queryKey: ['admin', 'user-quotas', pageUserIds],
    queryFn: async () => {
      const entries = await Promise.all(pageUserIds.map(async (id) => [id, await getUserQuotaById(id)] as const))
      return new Map(entries)
    },
    enabled: pageUserIds.length > 0,
  })

  const users: UserRow[] = useMemo(() => {
    const quota = quotaQuery.data
    return baseUsers.map((user) => ({
      ...user,
      quotaUsed: quota?.get(user.id)?.used ?? 0,
      quotaTotal: quota?.get(user.id)?.total ?? 0,
    }))
  }, [baseUsers, quotaQuery.data])

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

  const batchStatusMutation = useMutation({
    mutationFn: ({ ids, banned }: { ids: string[]; banned: boolean }) =>
      Promise.all(ids.map((id) => adminSetUserBanned(id, banned))),
    onSuccess: (_result, variables) => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.users.batchStatusUpdated', { count: variables.ids.length }))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => adminRemoveUser(id))),
    onSuccess: (_result, ids) => {
      setSelectedIds([])
      setBatchDeleteDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('admin.users.batchDeleted', { count: ids.length }))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const isUsersLoading = usersQuery.isLoading
  const selectedCount = selectedIds.length
  const allPageSelected = pageUserIds.length > 0 && pageUserIds.every((id) => selectedIds.includes(id))
  const batchPending = batchStatusMutation.isPending || batchDeleteMutation.isPending

  function updateListSearch(next: { q?: string; size?: number }, replace = false) {
    navigate({
      to: '/admin/users',
      search: {
        tab: listSearch.tab,
        q: next.q || undefined,
        size: next.size === DEFAULT_PAGE_SIZE ? undefined : next.size,
      },
      replace,
    })
    setSelectedIds([])
  }

  function selectTab(next: UsersTab) {
    navigate({
      to: '/admin/users',
      search: { ...listSearch, tab: next === 'users' ? undefined : next },
    })
  }

  function movePage(move: () => void) {
    move()
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
    setBatchDeleteDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.users.title')}
        actions={
          <>
            {tab === 'users' && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('admin.users.searchPlaceholder')}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  className="pl-9"
                />
              </div>
            )}
            <Button onClick={() => setInviteDrawerOpen(true)}>
              <UserPlus />
              {t('admin.users.inviteUser')}
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => selectTab(value as UsersTab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="users">{t('admin.users.tabUsers')}</TabsTrigger>
          <TabsTrigger value="invitations">{t('admin.users.tabInvitations')}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <span className="text-sm font-medium">{t('admin.users.selectedCount', { count: selectedCount })}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={batchPending}
                  onClick={() => batchStatusMutation.mutate({ ids: selectedIds, banned: true })}
                >
                  <UserX />
                  {t('admin.users.batchDisable')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={batchPending}
                  onClick={() => batchStatusMutation.mutate({ ids: selectedIds, banned: false })}
                >
                  <UserCheck />
                  {t('admin.users.batchEnable')}
                </Button>
                <Button variant="destructive" size="sm" disabled={batchPending} onClick={handleBatchDelete}>
                  <Trash2 />
                  {t('admin.users.batchDelete')}
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-[10%] px-4 py-3 text-left font-medium sm:w-[4%]">
                    <Checkbox
                      aria-label={t('admin.users.selectPage')}
                      checked={allPageSelected}
                      onCheckedChange={(checked) => togglePageSelection(checked === true)}
                    />
                  </th>
                  <th className="w-[38%] px-4 py-3 text-left font-medium sm:w-[21%]">{t('admin.users.colName')}</th>
                  <th className="hidden w-[23%] px-4 py-3 text-left font-medium sm:table-cell">
                    {t('admin.users.colEmail')}
                  </th>
                  <th className="w-[18%] px-4 py-3 text-left font-medium sm:w-[9%]">{t('admin.users.colRole')}</th>
                  <th className="w-[18%] px-4 py-3 text-left font-medium sm:w-[10%]">{t('admin.users.colStatus')}</th>
                  <th className="hidden w-[14%] px-4 py-3 text-left font-medium md:table-cell">
                    {t('admin.users.colQuota')}
                  </th>
                  <th className="hidden w-[11%] truncate px-4 py-3 text-left font-medium lg:table-cell">
                    {t('admin.users.colCreatedAt')}
                  </th>
                  <th className="w-[16%] px-4 py-3 text-right font-medium sm:w-[8%]">{t('admin.users.colActions')}</th>
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
                    onOpenUser={() => navigate({ to: '/admin/users/$userId', params: { userId: user.id } })}
                    onToggleStatus={() => toggleStatusMutation.mutate({ userId: user.id, banned: !user.banned })}
                    onDelete={() =>
                      setDeleteDialogUser({ id: user.id, name: user.name || user.username || user.email })
                    }
                  />
                ))}
                {isUsersLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      <div role="status" aria-live="polite">
                        {t('common.loading')}
                      </div>
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      {t('admin.users.noUsers')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <CursorPagination
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            hasPrevious={pager.hasPrevious}
            nextPageToken={usersQuery.data?.nextPageToken}
            disabled={usersQuery.isFetching}
            onPageSizeChange={(size) => updateListSearch({ q: search, size })}
            onPrevious={() => movePage(pager.previous)}
            onNext={(token) => movePage(() => pager.next(token))}
          />
        </TabsContent>

        <TabsContent value="invitations">
          <SiteInvitationsList />
        </TabsContent>
      </Tabs>

      <DeleteUserDialog
        open={deleteDialogUser !== null}
        onOpenChange={(open) => !open && setDeleteDialogUser(null)}
        user={deleteDialogUser}
      />

      <Dialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.users.batchDelete')}</DialogTitle>
            <DialogDescription>{t('admin.users.batchDeleteConfirm', { count: selectedCount })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBatchDeleteDialogOpen(false)}
              disabled={batchDeleteMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => batchDeleteMutation.mutate(selectedIds)}
              disabled={batchDeleteMutation.isPending || selectedCount === 0}
            >
              {batchDeleteMutation.isPending ? t('common.loading') : t('admin.users.batchDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteUserDrawer
        open={inviteDrawerOpen}
        onOpenChange={setInviteDrawerOpen}
        onInvited={() => selectTab('invitations')}
      />
    </div>
  )
}

function UserTableRow({
  user,
  selected,
  isToggling,
  showQuota,
  onSelect,
  onOpenUser,
  onToggleStatus,
  onDelete,
}: {
  user: UserRow
  selected: boolean
  isToggling: boolean
  showQuota: boolean
  onSelect: (checked: boolean) => void
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
  const quotaLabel = formatStorageUsage(user.quotaUsed, user.quotaTotal)

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <Checkbox
          aria-label={t('admin.users.selectUser', { name: user.name || user.username || user.email })}
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
      </td>
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
      <td className="hidden truncate px-4 py-3 text-muted-foreground sm:table-cell" title={user.email}>
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
      {showQuota && (
        <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">{quotaLabel}</td>
      )}
      <td className="hidden truncate px-4 py-3 text-muted-foreground lg:table-cell" title={formatDate(user.createdAt)}>
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
