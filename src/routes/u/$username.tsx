import type { PublicProfileShare, PublicUser } from '@shared/schemas/profile'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FileIcon, FolderIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getProfile } from '@/lib/api'

export const Route = createFileRoute('/u/$username')({
  component: ProfilePage,
})

function UserHeader({ profile }: { profile: PublicUser }) {
  return (
    <div className="flex items-center gap-4 border-b pb-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-semibold uppercase text-muted-foreground">
        {profile.image ? (
          <img src={profile.image} alt={profile.name} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          (profile.name?.[0] ?? profile.username[0])
        )}
      </div>
      <div>
        <h1 className="text-xl font-bold">{profile.name || profile.username}</h1>
        <p className="text-sm text-muted-foreground">@{profile.username}</p>
      </div>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <FolderIcon className="mb-3 h-12 w-12 opacity-30" />
      <p className="text-sm">{t('profile.noShares')}</p>
    </div>
  )
}

export function ProfilePage() {
  const { t } = useTranslation()
  const { username } = Route.useParams()

  const profileQuery = useQuery({
    queryKey: ['profile', username],
    queryFn: () => getProfile(username),
    retry: false,
  })

  if (profileQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (profileQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="text-muted-foreground">{t('profile.notFound')}</p>
      </div>
    )
  }

  const { user: profile, shares } = profileQuery.data!

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <UserHeader profile={profile} />
      <div className="mt-6">
        {shares.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {shares.map((share) => (
              <ProfileShareCard key={share.token} share={share} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileShareCard({ share }: { share: PublicProfileShare }) {
  const Icon = share.isFolder ? FolderIcon : FileIcon
  return (
    <a
      href={`/s/${share.token}`}
      className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="rounded-md bg-muted p-2">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{share.name}</p>
        <p className="truncate text-xs text-muted-foreground">{share.type}</p>
      </div>
    </a>
  )
}
