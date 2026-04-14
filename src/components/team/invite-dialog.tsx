import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authClient } from '@/lib/auth-client'
import { teamsApi } from '@/lib/rpc'

type InviteRole = 'editor' | 'viewer'

type PendingInvitation = {
  id: string
  email: string
  role: string
  expiresAt: string | null
  createdAt: string
}

function EmailInviteTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('viewer')

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.inviteMember({
        organizationId: orgId,
        email,
        role: role as 'member',
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.invite.sent'))
      setEmail('')
      setRole('viewer')
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invite-email">{t('teams.invite.emailLabel')}</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('teams.invite.emailPlaceholder')}
        />
      </div>
      <div className="space-y-2">
        <Label>{t('teams.invite.roleLabel')}</Label>
        <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">{t('teams.role.editor')}</SelectItem>
            <SelectItem value="viewer">{t('teams.role.viewer')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={mutation.isPending || !email}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t('common.loading') : t('teams.invite.sendButton')}
      </Button>
    </div>
  )
}

function LinkInviteTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const [role, setRole] = useState<InviteRole>('viewer')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await teamsApi[':teamId']['invite-link'].$post({
        param: { teamId: orgId },
        json: { role },
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error((body as { error?: string }).error ?? 'Failed to generate link')
      }
      return res.json()
    },
    onSuccess: (data) => {
      const url = `${window.location.origin}/teams/invite?token=${(data as { token: string }).token}`
      setGeneratedLink(url)
      setExpiresAt((data as { expiresAt: string | null }).expiresAt)
      toast.success(t('teams.invite.linkGenerated'))
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  function copyLink() {
    if (!generatedLink) return
    navigator.clipboard.writeText(generatedLink)
    toast.success(t('teams.invite.linkCopied'))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('teams.invite.roleLabel')}</Label>
        <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">{t('teams.role.editor')}</SelectItem>
            <SelectItem value="viewer">{t('teams.role.viewer')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t('common.loading') : t('teams.invite.generateLink')}
      </Button>
      {generatedLink && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={generatedLink} readOnly className="text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
              {t('teams.invite.copyLink')}
            </Button>
          </div>
          {expiresAt && (
            <p className="text-xs text-muted-foreground">
              {t('teams.invite.linkExpires', { date: new Date(expiresAt).toLocaleDateString() })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PendingInvitations({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['team-invitations', orgId],
    queryFn: async () => {
      const res = await teamsApi[':teamId'].invitations.$get({ param: { teamId: orgId } })
      if (!res.ok) throw new Error('Failed to load invitations')
      const body = await res.json()
      return (body as { invitations: PendingInvitation[] }).invitations
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await authClient.organization.cancelInvitation({ invitationId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.invite.cancelled'))
      queryClient.invalidateQueries({ queryKey: ['team-invitations', orgId] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('teams.invite.noPending')}</p>
  }

  return (
    <div className="space-y-2">
      {data.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{inv.email}</p>
            <p className="text-xs text-muted-foreground">
              {t('teams.invite.invitedAs', { role: t(`teams.role.${inv.role}`) })}
              {inv.expiresAt &&
                ` · ${t('teams.invite.expiresOn', { date: new Date(inv.expiresAt).toLocaleDateString() })}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-destructive hover:text-destructive"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate(inv.id)}
          >
            {t('teams.invite.cancelInvite')}
          </Button>
        </div>
      ))}
    </div>
  )
}

type Tab = 'email' | 'link'

export function InviteDialog({
  open,
  onOpenChange,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('email')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('teams.invite.title')}</DialogTitle>
          <DialogDescription>{t('teams.invite.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-1 rounded-md border p-1">
            <button
              type="button"
              onClick={() => setActiveTab('email')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'email'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('teams.invite.emailTab')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('link')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'link'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('teams.invite.linkTab')}
            </button>
          </div>

          {activeTab === 'email' ? <EmailInviteTab orgId={orgId} /> : <LinkInviteTab orgId={orgId} />}

          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">{t('teams.invite.pendingTitle')}</p>
            <PendingInvitations orgId={orgId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
