import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
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

function createEmailInviteSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().trim().min(1, t('teams.invite.emailRequired')).email(t('teams.invite.emailInvalid')),
    role: z.enum(['editor', 'viewer']),
  })
}

type EmailInviteValues = z.infer<ReturnType<typeof createEmailInviteSchema>>

const EMPTY_EMAIL_INVITE: EmailInviteValues = { email: '', role: 'viewer' }

function EmailInviteTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const form = useForm<EmailInviteValues>({
    resolver: zodResolver(createEmailInviteSchema(t)),
    defaultValues: EMPTY_EMAIL_INVITE,
  })
  const role = form.watch('role')
  const emailError = form.formState.errors.email?.message

  const mutation = useMutation({
    mutationFn: async (values: EmailInviteValues) => {
      const { error } = await authClient.organization.inviteMember({
        organizationId: orgId,
        email: values.email,
        role: values.role as 'member',
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.invite.sent'))
      form.reset(EMPTY_EMAIL_INVITE)
    },
  })
  const serverError = mutation.error
    ? ((mutation.error as { message?: string }).message ?? String(mutation.error))
    : null

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <div className="space-y-2">
        <Label htmlFor="invite-email">{t('teams.invite.emailLabel')}</Label>
        <Input
          id="invite-email"
          type="email"
          {...form.register('email', { onChange: () => mutation.reset() })}
          placeholder={t('teams.invite.emailPlaceholder')}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'invite-email-error' : undefined}
          aria-required
        />
        {emailError && (
          <p id="invite-email-error" className="text-xs text-destructive">
            {emailError}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label>{t('teams.invite.roleLabel')}</Label>
        <Select value={role} onValueChange={(v) => form.setValue('role', v as InviteRole, { shouldDirty: true })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">{t('teams.role.editor')}</SelectItem>
            <SelectItem value="viewer">{t('teams.role.viewer')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending || !form.formState.isDirty}>
        {mutation.isPending ? t('common.loading') : t('teams.invite.sendButton')}
      </Button>
    </form>
  )
}

function LinkInviteTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const [role, setRole] = useState<InviteRole>('viewer')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await teamsApi[':teamId']['invite-links'].$post({
        param: { teamId: orgId },
        json: { role },
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error((body as { error?: { message?: string } }).error?.message ?? 'Failed to generate link')
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
      return (body as { items: PendingInvitation[] }).items
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
