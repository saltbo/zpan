import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { InviteDialog } from '@/components/team/invite-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId/members')({
  component: TeamMembersPage,
})

type Role = 'owner' | 'admin' | 'member' | 'editor' | 'viewer'

type OrgMember = {
  id: string
  userId: string
  role: Role
  createdAt: Date | string
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
}

type FullOrganization = {
  id: string
  name: string
  members: OrgMember[]
}

function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation()
  const colorMap: Record<Role, string> = {
    owner: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    admin: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    member: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    editor: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[role]}`}>{t(`teams.role.${role}`)}</span>
  )
}

function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: OrgMember
  orgId: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.removeMember({
        organizationId: orgId,
        memberIdOrEmail: member.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.members.removed'))
      queryClient.invalidateQueries({ queryKey: ['organization', orgId] })
      onOpenChange(false)
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.members.removeTitle')}</DialogTitle>
          <DialogDescription>
            {t('teams.members.removeConfirm', { name: member.user.name || member.user.email })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveTeamDialog({
  open,
  onOpenChange,
  member,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: OrgMember
  orgId: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.removeMember({
        organizationId: orgId,
        memberIdOrEmail: member.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.members.left'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', orgId] })
      onOpenChange(false)
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.members.leaveTitle')}</DialogTitle>
          <DialogDescription>{t('teams.members.leaveConfirm')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? t('common.loading') : t('teams.members.leave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemberRow({
  member,
  orgId,
  isCurrentUser,
  isOwner,
  ownerCount,
}: {
  member: OrgMember
  orgId: string
  isCurrentUser: boolean
  isOwner: boolean
  ownerCount: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [removeOpen, setRemoveOpen] = useState(false)

  const roleMutation = useMutation({
    mutationFn: async (role: Role) => {
      const { error } = await authClient.organization.updateMemberRole({
        organizationId: orgId,
        memberId: member.id,
        role,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.members.roleUpdated'))
      queryClient.invalidateQueries({ queryKey: ['organization', orgId] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  const canChangeRole = isOwner && !isCurrentUser
  const isLastOwner = member.role === 'owner' && ownerCount <= 1
  const canRemove = isOwner && !isCurrentUser && member.role !== 'owner'

  const joinedDate = new Date(member.createdAt as string).toLocaleDateString()

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={member.user.image ?? undefined} />
          <AvatarFallback>{(member.user.name || member.user.email).charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{member.user.name || member.user.email}</span>
            {isCurrentUser && <span className="text-xs text-muted-foreground">({t('teams.members.you')})</span>}
          </div>
          <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
          <p className="text-xs text-muted-foreground">{t('teams.members.joinedOn', { date: joinedDate })}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canChangeRole ? (
          <Select
            value={member.role}
            onValueChange={(value) => {
              if (isLastOwner && value !== 'owner') {
                toast.error(t('teams.members.lastOwnerError'))
                return
              }
              roleMutation.mutate(value as Role)
            }}
            disabled={roleMutation.isPending}
          >
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">{t('teams.role.owner')}</SelectItem>
              <SelectItem value="admin">{t('teams.role.admin')}</SelectItem>
              <SelectItem value="member">{t('teams.role.member')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <RoleBadge role={member.role} />
        )}

        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive h-8 px-2"
            onClick={() => setRemoveOpen(true)}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>

      <RemoveMemberDialog open={removeOpen} onOpenChange={setRemoveOpen} member={member} orgId={orgId} />
    </div>
  )
}

function TeamMembersPage() {
  const { t } = useTranslation()
  const { teamId } = Route.useParams()
  const { data: session } = useSession()
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const {
    data: org,
    isPending,
    error,
  } = useQuery({
    queryKey: ['organization', teamId],
    queryFn: async () => {
      const { data, error: err } = await authClient.organization.getFullOrganization({
        query: { organizationId: teamId },
      })
      if (err) throw err
      return data as unknown as FullOrganization | null
    },
    enabled: !!teamId,
  })

  const userId = session?.user?.id ?? ''
  const myMembership = org?.members.find((m) => m.userId === userId)
  const isOwner = myMembership?.role === 'owner'
  const ownerCount = org?.members.filter((m) => m.role === 'owner').length ?? 0

  if (isPending) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  if (error || !org) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('teams.loadError')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">{t('teams.memberCount', { count: org.members.length })}</span>
        {isOwner && (
          <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
            {t('teams.invite.button')}
          </Button>
        )}
      </div>

      {isOwner && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} orgId={org.id} />}

      <div className="space-y-2">
        {org.members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            orgId={org.id}
            isCurrentUser={member.userId === userId}
            isOwner={isOwner}
            ownerCount={ownerCount}
          />
        ))}
      </div>

      {myMembership && !isOwner && (
        <div className="rounded-md border border-destructive/30 p-4">
          <p className="text-sm text-muted-foreground mb-3">{t('teams.members.leaveDescription')}</p>
          <Button type="button" variant="destructive" size="sm" onClick={() => setLeaveOpen(true)}>
            {t('teams.members.leave')}
          </Button>
        </div>
      )}

      {myMembership && !isOwner && (
        <LeaveTeamDialog open={leaveOpen} onOpenChange={setLeaveOpen} member={myMembership} orgId={org.id} />
      )}
    </div>
  )
}
