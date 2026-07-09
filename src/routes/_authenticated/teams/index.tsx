import { zodResolver } from '@hookform/resolvers/zod'
import { FREE_TEAM_LIMIT } from '@shared/constants'
import { generateTeamOrgSlug, isTeamOrgLike } from '@shared/org-slugs'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { PageHeader } from '@/components/layout/page-header'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEntitlement } from '@/hooks/useEntitlement'
import { authClient, getFullOrganization, useListOrganizations, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/')({
  component: TeamsPage,
})

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  logo: z.string().url().optional().or(z.literal('')),
})

type CreateTeamValues = z.infer<typeof createTeamSchema>

function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const form = useForm<CreateTeamValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: '', logo: '' },
  })

  const mutation = useMutation({
    mutationFn: async (values: CreateTeamValues) => {
      const { error, data } = await authClient.organization.create({
        name: values.name,
        slug: generateTeamOrgSlug(),
        logo: values.logo || undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: async (data) => {
      toast.success(t('teams.created'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      onOpenChange(false)
      form.reset()
      if (data?.id) {
        await authClient.organization.setActive({ organizationId: data.id })
        navigate({ to: '/files' })
      }
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">{t('teams.teamName')}</Label>
            <Input id="team-name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-logo">
              {t('teams.logo')} <span className="text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Input id="team-logo" placeholder="https://..." {...form.register('logo')} />
            {form.formState.errors.logo && (
              <p className="text-xs text-destructive">{form.formState.errors.logo.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0">
        <UpgradeHint feature="teams_unlimited" />
      </DialogContent>
    </Dialog>
  )
}

type TeamCardOrg = {
  id: string
  name: string
  slug: string
  logo?: string | null
  members: Array<{ userId: string; role: string }>
}

function TeamCard({ org, userId }: { org: TeamCardOrg; userId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const myMembership = org.members.find((m) => m.userId === userId)
  const role = myMembership?.role ?? ''

  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/teams/$teamId', params: { teamId: org.id } })}
      className="flex w-full items-start gap-4 rounded-md border bg-card p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-muted">
        {org.logo ? (
          <img src={org.logo} alt={org.name} className="h-full w-full rounded-md object-cover" />
        ) : (
          <Users className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{org.name}</p>
        <p className="text-sm text-muted-foreground">@{org.slug}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm text-muted-foreground">{t('teams.memberCount', { count: org.members.length })}</span>
        {role && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{role}</span>
        )}
      </div>
    </button>
  )
}

type ListOrganization = {
  id: string
  slug: string
  metadata?: Record<string, unknown> | string | null
}

function TeamsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: orgs, isPending: orgsLoading } = useListOrganizations()
  const { hasFeature } = useEntitlement()
  const [createOpen, setCreateOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const userId = session?.user?.id ?? ''
  const teamOrgs = (orgs ?? []).filter((o: ListOrganization) => isTeamOrgLike(o))

  // Total org count includes personal workspace — counts toward the community team limit.
  // Guard with !orgsLoading to avoid a brief false state while orgs are being fetched.
  const totalOrgCount = (orgs ?? []).length
  const isAtLimit = !orgsLoading && !hasFeature('teams_unlimited') && totalOrgCount >= FREE_TEAM_LIMIT

  const fullOrgQueries = useQueries({
    queries: teamOrgs.map((o: ListOrganization) => ({
      queryKey: ['organization', 'full', o.id],
      queryFn: async () => {
        const { data, error } = await getFullOrganization({ query: { organizationId: o.id } })
        if (error) throw error
        return data
      },
    })),
  })

  const isPending = orgsLoading || fullOrgQueries.some((q) => q.isPending)
  const teams = fullOrgQueries.flatMap((q) => (q.data ? [q.data] : []))

  function handleNewTeamClick() {
    if (isAtLimit) {
      setUpgradeOpen(true)
    } else {
      setCreateOpen(true)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        items={[
          {
            label: t('teams.title'),
            icon: <Users className="size-4 text-muted-foreground" />,
          },
        ]}
        actions={
          <Button onClick={handleNewTeamClick} size="sm">
            <Plus />
            <span className="sr-only sm:not-sr-only">{t('teams.createNew')}</span>
            {isAtLimit && <ProBadge className="ml-1" />}
          </Button>
        }
      />

      {isPending ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('teams.empty')}</div>
      ) : (
        <div className="space-y-2">
          {teams.map((org) => (
            <TeamCard key={org.id} org={org} userId={userId} />
          ))}
        </div>
      )}

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  )
}
