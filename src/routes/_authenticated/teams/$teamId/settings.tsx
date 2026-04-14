import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId/settings')({
  component: TeamSettingsPage,
})

const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug_invalid'),
  logo: z.string().url().optional().or(z.literal('')),
})

type SettingsValues = z.infer<typeof settingsSchema>

type FullOrganization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
  members: Array<{ userId: string; role: string }>
}

function DeleteTeamDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  orgName: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.delete({ organizationId: orgId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.deleted'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      navigate({ to: '/teams' })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('teams.deleteConfirm', { name: orgName })}</DialogDescription>
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

function TeamSettingsForm({ org }: { org: FullOrganization }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { name: '', slug: '', logo: '' },
  })

  useEffect(() => {
    form.reset({
      name: org.name,
      slug: org.slug,
      logo: org.logo ?? '',
    })
  }, [org.name, org.slug, org.logo, form])

  const mutation = useMutation({
    mutationFn: async (values: SettingsValues) => {
      const { error } = await authClient.organization.update({
        organizationId: org.id,
        data: {
          name: values.name,
          slug: values.slug,
          logo: values.logo || undefined,
        },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.saved'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', org.id] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">{t('teams.teamName')}</Label>
        <Input id="org-name" {...form.register('name')} />
        {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-slug">{t('teams.slug')}</Label>
        <Input id="org-slug" {...form.register('slug')} />
        {form.formState.errors.slug && <p className="text-xs text-destructive">{t('teams.slugInvalid')}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-logo">
          {t('teams.logo')} <span className="text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input id="org-logo" placeholder="https://..." {...form.register('logo')} />
        {form.formState.errors.logo && <p className="text-xs text-destructive">{form.formState.errors.logo.message}</p>}
      </div>

      <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
        {mutation.isPending ? t('common.loading') : t('common.save')}
      </Button>
    </form>
  )
}

function TeamSettingsPage() {
  const { t } = useTranslation()
  const { teamId } = Route.useParams()
  const { data: session } = useSession()
  const [deleteOpen, setDeleteOpen] = useState(false)

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
      return data as FullOrganization | null
    },
    enabled: !!teamId,
  })

  const userId = session?.user?.id ?? ''
  const myMembership = org?.members.find((m) => m.userId === userId)
  const isOwner = myMembership?.role === 'owner'

  if (isPending) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
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

  if (!isOwner) {
    return <div className="rounded-md border p-4 text-sm text-muted-foreground">{t('teams.ownerOnly')}</div>
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('teams.settingsTitle')}</h2>
      <div className="max-w-lg space-y-6">
        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{t('teams.generalSection')}</h3>
          <TeamSettingsForm org={org} />
        </div>

        <div className="space-y-4 rounded-md border border-destructive/30 p-4">
          <h3 className="text-sm font-medium text-destructive">{t('teams.dangerZone')}</h3>
          <p className="text-sm text-muted-foreground">{t('teams.deleteWarning')}</p>
          <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
            {t('teams.deleteTeam')}
          </Button>
        </div>
      </div>

      <DeleteTeamDialog open={deleteOpen} onOpenChange={setDeleteOpen} orgId={org.id} orgName={org.name} />
    </div>
  )
}
