import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, useListOrganizations, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/')({
  component: TeamsPage,
})

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug_invalid'),
  logo: z.string().url().optional().or(z.literal('')),
})

type CreateTeamValues = z.infer<typeof createTeamSchema>

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const form = useForm<CreateTeamValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: '', slug: '', logo: '' },
  })

  const mutation = useMutation({
    mutationFn: async (values: CreateTeamValues) => {
      const { error, data } = await authClient.organization.create({
        name: values.name,
        slug: values.slug,
        logo: values.logo || undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success(t('teams.created'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      onOpenChange(false)
      form.reset()
      if (data?.id) {
        navigate({ to: '/files' })
      }
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    form.setValue('name', e.target.value)
    if (!form.getFieldState('slug').isDirty) {
      form.setValue('slug', slugify(e.target.value), { shouldValidate: false })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">{t('teams.teamName')}</Label>
            <Input id="team-name" {...form.register('name')} onChange={handleNameChange} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-slug">{t('teams.slug')}</Label>
            <Input id="team-slug" {...form.register('slug')} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{t('teams.slugInvalid')}</p>}
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

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
  members?: Array<{ userId: string; role: string }>
}

function TeamCard({ org, userId }: { org: Organization; userId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const members = org.members ?? []
  const myMembership = members.find((m) => m.userId === userId)
  const role = myMembership?.role ?? ''

  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/teams/$teamId/settings', params: { teamId: org.id } })}
      className="flex w-full items-start gap-4 rounded-md border p-4 text-left transition-colors hover:bg-accent"
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
        <span className="text-sm text-muted-foreground">{t('teams.memberCount', { count: members.length })}</span>
        {role && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{role}</span>
        )}
      </div>
    </button>
  )
}

function TeamsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: orgs, isPending } = useListOrganizations()
  const [createOpen, setCreateOpen] = useState(false)

  const userId = session?.user?.id ?? ''
  const teams = (orgs ?? []).filter(
    (o: Organization) => (o.metadata as Record<string, unknown> | undefined)?.type !== 'personal',
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('teams.title')}</h2>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          {t('teams.createNew')}
        </Button>
      </div>

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
          {teams.map((org: Organization) => (
            <TeamCard key={org.id} org={org} userId={userId} />
          ))}
        </div>
      )}

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
