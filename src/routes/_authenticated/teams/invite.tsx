import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { publicTeamsApi, teamsApi } from '@/lib/rpc'

export const Route = createFileRoute('/_authenticated/teams/invite')({
  validateSearch: z.object({ token: z.string().min(1) }),
  component: TeamInvitePage,
})

type InviteInfo = {
  organizationId: string
  organizationName: string
  role: string
  expiresAt: string | null
}

function TeamInvitePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = Route.useSearch()

  const {
    data: info,
    isPending,
    error,
  } = useQuery({
    queryKey: ['invite-info', token],
    queryFn: async () => {
      const res = await publicTeamsApi['invite-info'].$get({ query: { token } })
      if (!res.ok) return null
      return res.json() as Promise<InviteInfo>
    },
  })

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await teamsApi.join.$post({ json: { token } })
      if (!res.ok) {
        const body = await res.json()
        throw new Error((body as { error?: string }).error ?? 'Failed to join')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(t('teams.invite.accepted'))
      navigate({ to: '/teams' })
    },
    onError: (err: { message?: string }) => {
      const msg = err.message ?? String(err)
      if (msg.includes('Already a member') || msg.includes('already_member')) {
        toast.info(t('teams.invite.alreadyMember'))
        navigate({ to: '/teams' })
      } else {
        toast.error(msg)
      }
    },
  })

  if (isPending) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
        <p className="text-destructive">{t('teams.invite.invalidToken')}</p>
        <Button variant="outline" onClick={() => navigate({ to: '/teams' })}>
          {t('nav.teams')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">{t('teams.invite.acceptTitle')}</h1>
        <p className="text-muted-foreground">
          {t('teams.invite.acceptDescription', {
            team: info.organizationName,
            role: t(`teams.role.${info.role}`),
          })}
        </p>
        {info.expiresAt && (
          <p className="text-sm text-muted-foreground">
            {t('teams.invite.expiresOn', { date: new Date(info.expiresAt).toLocaleDateString() })}
          </p>
        )}
      </div>
      <Button disabled={joinMutation.isPending} onClick={() => joinMutation.mutate()}>
        {joinMutation.isPending ? t('common.loading') : t('teams.invite.accept')}
      </Button>
    </div>
  )
}
