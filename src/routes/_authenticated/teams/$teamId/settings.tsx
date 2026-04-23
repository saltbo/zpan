import { zodResolver } from '@hookform/resolvers/zod'
import type { OrgLogoMime } from '@shared/schemas'
import { MAX_ORG_LOGO_SIZE, ORG_LOGO_MIMES } from '@shared/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Camera, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { commitOrgLogo, deleteOrgLogo, requestOrgLogoUpload, uploadToS3 } from '@/lib/api'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId/settings')({
  component: TeamSettingsPage,
})

const nameSchema = z.object({
  name: z.string().min(1).max(100),
})
const slugSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug_invalid'),
})

type NameValues = z.infer<typeof nameSchema>
type SlugValues = z.infer<typeof slugSchema>

type FullOrganization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
  members: Array<{ userId: string; role: string }>
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function LogoCard({ org }: { org: FullOrganization }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!ORG_LOGO_MIMES.includes(file.type as OrgLogoMime)) {
        throw new Error(t('teams.logo.invalidMime'))
      }
      if (file.size > MAX_ORG_LOGO_SIZE) {
        throw new Error(t('teams.logo.tooLarge'))
      }
      const draft = await requestOrgLogoUpload(org.id, { mime: file.type as OrgLogoMime, size: file.size })
      await uploadToS3(draft.uploadUrl, file)
      await commitOrgLogo(org.id, { mime: file.type as OrgLogoMime })
    },
    onSuccess: () => {
      toast.success(t('teams.logo.uploaded'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', org.id] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrgLogo(org.id),
    onSuccess: () => {
      toast.success(t('teams.logo.removed'))
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', org.id] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  const isPending = uploadMutation.isPending || deleteMutation.isPending

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  function triggerPicker() {
    if (!isPending) fileInputRef.current?.click()
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-6 px-6">
        <div className="space-y-1.5">
          <CardTitle>{t('teams.logo')}</CardTitle>
          <CardDescription>{t('teams.logo.description')}</CardDescription>
        </div>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={isPending}
          aria-label={t('teams.logo.upload')}
          className="group relative flex-shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="size-20 border">
            {org.logo && <AvatarImage src={org.logo} alt={org.name} />}
            <AvatarFallback className="text-xl font-semibold">{getInitials(org.name)}</AvatarFallback>
          </Avatar>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {isPending ? (
              <Loader2 className="size-5 animate-spin text-white" />
            ) : (
              <Camera className="size-5 text-white" />
            )}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ORG_LOGO_MIMES.join(',')}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <CardFooter className="justify-between border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('teams.logo.hint')}</p>
        {org.logo && (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => deleteMutation.mutate()}>
            {t('teams.logo.remove')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function TeamNameCard({ org }: { org: FullOrganization }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const form = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  useEffect(() => {
    form.reset({ name: org.name })
  }, [org.name, form])

  const mutation = useMutation({
    mutationFn: async (values: NameValues) => {
      const { error } = await authClient.organization.update({
        organizationId: org.id,
        data: { name: values.name },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.saved'))
      form.reset(form.getValues())
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', org.id] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <Card>
        <CardHeader>
          <CardTitle>{t('teams.teamName')}</CardTitle>
          <CardDescription>{t('teams.teamName.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Input {...form.register('name')} maxLength={100} />
          {form.formState.errors.name && (
            <p className="mt-1.5 text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </CardContent>
        <CardFooter className="justify-between border-t bg-muted/30">
          <p className="text-sm text-muted-foreground">{t('teams.teamName.hint')}</p>
          <Button type="submit" size="sm" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function SlugCard({ org }: { org: FullOrganization }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const form = useForm<SlugValues>({
    resolver: zodResolver(slugSchema),
    defaultValues: { slug: '' },
  })

  useEffect(() => {
    form.reset({ slug: org.slug })
  }, [org.slug, form])

  const mutation = useMutation({
    mutationFn: async (values: SlugValues) => {
      const { error } = await authClient.organization.update({
        organizationId: org.id,
        data: { slug: values.slug },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('teams.saved'))
      form.reset(form.getValues())
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['organization', org.id] })
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <Card>
        <CardHeader>
          <CardTitle>{t('teams.slug')}</CardTitle>
          <CardDescription>{t('teams.slug.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Input {...form.register('slug')} maxLength={60} />
          {form.formState.errors.slug && <p className="mt-1.5 text-xs text-destructive">{t('teams.slugInvalid')}</p>}
        </CardContent>
        <CardFooter className="justify-between border-t bg-muted/30">
          <p className="text-sm text-muted-foreground">{t('teams.slug.hint')}</p>
          <Button type="submit" size="sm" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function DangerZoneCard({ org }: { org: FullOrganization }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.delete({ organizationId: org.id })
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
    <>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('teams.dangerZone')}</CardTitle>
          <CardDescription>{t('teams.deleteWarning')}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end border-t border-destructive/50 bg-destructive/5">
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
            {t('teams.deleteTeam')}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('teams.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('teams.deleteConfirm', { name: org.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TeamSettingsPage() {
  const { t } = useTranslation()
  const { teamId } = Route.useParams()
  const { data: session } = useSession()

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
      <div className="max-w-2xl space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />
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
    return (
      <Card className="max-w-2xl">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{t('teams.ownerOnly')}</CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <LogoCard org={org} />
      <TeamNameCard org={org} />
      <SlugCard org={org} />
      <DangerZoneCard org={org} />
    </div>
  )
}
