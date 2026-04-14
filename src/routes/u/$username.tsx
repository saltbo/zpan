import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { FileIcon, FolderIcon, HomeIcon } from 'lucide-react'
import type { PublicMatter, PublicUser } from '@/lib/api'
import { browseProfile, getProfile } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { DirType } from '../../../shared/constants'

interface ProfileSearch {
  dir?: string
}

export const Route = createFileRoute('/u/$username')({
  validateSearch: (search: Record<string, unknown>): ProfileSearch => ({
    dir: (search.dir as string) || undefined,
  }),
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

function Breadcrumb({ username, breadcrumb }: { username: string; breadcrumb: string[] }) {
  const navigate = useNavigate()

  if (breadcrumb.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => navigate({ to: '/u/$username', params: { username } })}
        className="flex items-center gap-1 hover:text-foreground"
      >
        <HomeIcon className="h-3.5 w-3.5" />
      </button>
      {breadcrumb.map((segment, i) => {
        const dir = breadcrumb.slice(0, i + 1).join('/')
        const isLast = i === breadcrumb.length - 1
        return (
          <span key={dir} className="flex items-center gap-1">
            <span>/</span>
            {isLast ? (
              <span className="text-foreground">{segment}</span>
            ) : (
              <button
                type="button"
                onClick={() => navigate({ to: '/u/$username', params: { username }, search: { dir } })}
                className="hover:text-foreground"
              >
                {segment}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function MatterItem({ matter, username }: { matter: PublicMatter; username: string }) {
  const navigate = useNavigate()
  const isFolder = matter.dirtype !== DirType.FILE

  function handleClick() {
    if (isFolder) {
      const dir = matter.parent ? `${matter.parent}/${matter.name}` : matter.name
      navigate({ to: '/u/$username', params: { username }, search: { dir } })
    } else if (matter.downloadUrl) {
      window.open(matter.downloadUrl, '_blank')
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
    >
      {isFolder ? (
        <FolderIcon className="h-8 w-8 shrink-0 text-amber-400" />
      ) : (
        <FileIcon className="h-8 w-8 shrink-0 text-blue-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{matter.name}</p>
        {!isFolder && matter.size > 0 && <p className="text-xs text-muted-foreground">{formatSize(matter.size)}</p>}
      </div>
    </button>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <FolderIcon className="mb-3 h-12 w-12 opacity-30" />
      <p className="text-sm">This user hasn&apos;t shared anything yet</p>
    </div>
  )
}

function ProfilePage() {
  const { username } = Route.useParams()
  const { dir } = useSearch({ from: '/u/$username' })

  const profileQuery = useQuery({
    queryKey: ['profile', username],
    queryFn: () => getProfile(username),
    retry: false,
  })

  const browseQuery = useQuery({
    queryKey: ['profile-browse', username, dir],
    queryFn: () => browseProfile(username, dir ?? ''),
    enabled: !!dir,
    retry: false,
  })

  if (profileQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (profileQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="text-muted-foreground">User not found</p>
      </div>
    )
  }

  const { user: profile, shares } = profileQuery.data!
  const items = dir ? (browseQuery.data?.items ?? []) : shares
  const breadcrumb = dir ? (browseQuery.data?.breadcrumb ?? []) : []
  const isLoading = dir ? browseQuery.isPending : false

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <UserHeader profile={profile} />
      <div className="mt-6 space-y-4">
        {dir && <Breadcrumb username={username} breadcrumb={breadcrumb} />}
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-2">
            {items.map((matter) => (
              <MatterItem key={matter.id} matter={matter} username={username} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
