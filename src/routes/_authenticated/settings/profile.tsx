import { zodResolver } from '@hookform/resolvers/zod'
import type { AvatarMime } from '@shared/schemas'
import { AVATAR_MIMES, MAX_AVATAR_SIZE } from '@shared/schemas'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { commitAvatar, deleteAvatar, requestAvatarUpload, uploadToS3 } from '@/lib/api'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfilePage,
})

const profileSchema = z.object({
  displayName: z.string().min(1).max(100),
})

type ProfileFormValues = z.infer<typeof profileSchema>

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// refreshSession forces the auth client to re-fetch the session from the server
// so that useSession() reflects DB changes made outside better-auth's updateUser.
async function refreshSession() {
  await authClient.getSession()
}

export function AvatarSection() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const user = session?.user

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!AVATAR_MIMES.includes(file.type as AvatarMime)) {
        throw new Error(t('settings.profile.avatar.invalidMime'))
      }
      if (file.size > MAX_AVATAR_SIZE) {
        throw new Error(t('settings.profile.avatar.tooLarge'))
      }
      const draft = await requestAvatarUpload({ mime: file.type as AvatarMime, size: file.size })
      await uploadToS3(draft.uploadUrl, file)
      await commitAvatar({ mime: file.type as AvatarMime })
      await refreshSession()
    },
    onSuccess: () => toast.success(t('settings.profile.avatar.uploaded')),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await deleteAvatar()
      await refreshSession()
    },
    onSuccess: () => toast.success(t('settings.profile.avatar.removed')),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) uploadMutation.mutate(file)
  }

  const isPending = uploadMutation.isPending || deleteMutation.isPending
  const displayName = user?.name || (user as { username?: string })?.username || '?'

  return (
    <section
      className="flex items-center gap-6"
      aria-label={t('settings.profile.avatar.dropZone')}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative">
        <Avatar size="lg" className="size-16">
          {user?.image && <AvatarImage src={user.image} alt={displayName} />}
          <AvatarFallback className="text-lg font-semibold">{getInitials(displayName)}</AvatarFallback>
        </Avatar>
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <span className="text-xs text-white">{t('common.loading')}</span>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={AVATAR_MIMES.join(',')}
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
          {t('settings.profile.avatar.upload')}
        </Button>
        {user?.image && (
          <Button variant="ghost" size="sm" disabled={isPending} onClick={() => deleteMutation.mutate()}>
            {t('settings.profile.avatar.remove')}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{t('settings.profile.avatar.hint')}</p>
      </div>
    </section>
  )
}

export function ProfileForm() {
  const { t } = useTranslation()
  const { data: session } = useSession()

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '' },
  })

  useEffect(() => {
    if (session?.user?.name) {
      form.reset({ displayName: session.user.name })
    }
  }, [session?.user?.name, form])

  const mutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const { error } = await authClient.updateUser({ name: values.displayName })
      if (error) throw error
    },
    onSuccess: () => toast.success(t('settings.profile.saved')),
    onError: (err) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">{t('settings.profile.displayName')}</Label>
        <Input id="displayName" {...form.register('displayName')} />
        {form.formState.errors.displayName && (
          <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="username">{t('settings.profile.username')}</Label>
        <Input id="username" value={(session?.user as { username?: string })?.username ?? ''} disabled />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">{t('settings.profile.email')}</Label>
        <Input id="email" value={session?.user?.email ?? ''} disabled />
        <p className="text-xs text-muted-foreground">{t('settings.profile.emailReadonly')}</p>
      </div>

      <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
        {mutation.isPending ? t('common.loading') : t('common.save')}
      </Button>
    </form>
  )
}

function ProfilePage() {
  const { t } = useTranslation()

  return (
    <div className="max-w-lg space-y-4">
      <Card className="gap-4 p-4 shadow-none">
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.profile.avatar.section')}</h3>
        <AvatarSection />
      </Card>
      <Card className="gap-4 p-4 shadow-none">
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.profile.section')}</h3>
        <ProfileForm />
      </Card>
    </div>
  )
}
