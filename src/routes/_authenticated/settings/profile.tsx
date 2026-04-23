import { zodResolver } from '@hookform/resolvers/zod'
import type { PublicImageMime } from '@shared/schemas'
import { MAX_PUBLIC_IMAGE_SIZE, PUBLIC_IMAGE_MIMES } from '@shared/schemas'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Camera, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { deleteAvatar, uploadAvatar } from '@/lib/api'
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

// Refresh the session so useSession() sees DB changes made outside
// better-auth.updateUser (e.g. avatar commit / delete).
async function refreshSession() {
  await authClient.getSession()
}

function AvatarCard() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const user = session?.user
  const displayName = user?.name || (user as { username?: string })?.username || '?'

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!PUBLIC_IMAGE_MIMES.includes(file.type as PublicImageMime)) {
        throw new Error(t('settings.profile.avatar.invalidMime'))
      }
      if (file.size > MAX_PUBLIC_IMAGE_SIZE) {
        throw new Error(t('settings.profile.avatar.tooLarge'))
      }
      await uploadAvatar(file)
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
          <CardTitle>{t('settings.profile.avatar.section')}</CardTitle>
          <CardDescription>{t('settings.profile.avatar.description')}</CardDescription>
        </div>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={isPending}
          aria-label={t('settings.profile.avatar.upload')}
          className="group relative flex-shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="size-20 border">
            {user?.image && <AvatarImage src={user.image} alt={displayName} />}
            <AvatarFallback className="text-xl font-semibold">{getInitials(displayName)}</AvatarFallback>
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
          accept={PUBLIC_IMAGE_MIMES.join(',')}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <CardFooter className="justify-between border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('settings.profile.avatar.hint')}</p>
        {user?.image && (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => deleteMutation.mutate()}>
            {t('settings.profile.avatar.remove')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function DisplayNameCard() {
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
    onSuccess: () => {
      toast.success(t('settings.profile.saved'))
      form.reset(form.getValues())
    },
    onError: (err) => toast.error(err.message ?? String(err)),
  })

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.profile.displayName')}</CardTitle>
          <CardDescription>{t('settings.profile.displayName.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Input {...form.register('displayName')} maxLength={100} />
          {form.formState.errors.displayName && (
            <p className="mt-1.5 text-xs text-destructive">{form.formState.errors.displayName.message}</p>
          )}
        </CardContent>
        <CardFooter className="justify-between border-t bg-muted/30">
          <p className="text-sm text-muted-foreground">{t('settings.profile.displayName.hint')}</p>
          <Button type="submit" size="sm" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function UsernameCard() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const username = (session?.user as { username?: string })?.username ?? ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.profile.username')}</CardTitle>
        <CardDescription>{t('settings.profile.username.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex">
          <span className="inline-flex select-none items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
            @
          </span>
          <Input value={username} disabled className="rounded-l-none" />
        </div>
      </CardContent>
      <CardFooter className="border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('settings.profile.username.hint')}</p>
      </CardFooter>
    </Card>
  )
}

function EmailCard() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const email = session?.user?.email ?? ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.profile.email')}</CardTitle>
        <CardDescription>{t('settings.profile.email.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Input value={email} disabled />
      </CardContent>
      <CardFooter className="border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('settings.profile.emailReadonly')}</p>
      </CardFooter>
    </Card>
  )
}

function ProfilePage() {
  return (
    <div className="max-w-2xl space-y-6">
      <AvatarCard />
      <DisplayNameCard />
      <UsernameCard />
      <EmailCard />
    </div>
  )
}
