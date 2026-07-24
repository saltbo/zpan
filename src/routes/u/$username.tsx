import type { PublicProfileShare, PublicUser } from '@shared/schemas/profile'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight, FileIcon, FolderIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getProfile } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/u/$username')({
  component: ProfilePage,
})

function UserHeader({ profile, shares }: { profile: PublicUser; shares: PublicProfileShare[] }) {
  const { t } = useTranslation()
  const folders = shares.filter((share) => share.isFolder).length
  const files = shares.length - folders
  const displayName = profile.name || profile.username

  return (
    <section
      className="grid min-h-36 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-5 px-1 pb-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
      aria-labelledby="profile-title"
    >
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[17px] bg-primary text-lg font-bold uppercase text-primary-foreground">
        {profile.image ? (
          <img
            src={profile.image}
            alt={t('profile.avatarAlt', { name: displayName })}
            className="size-full object-cover"
          />
        ) : (
          (displayName[0] ?? profile.username[0])
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1 id="profile-title" className="text-xl font-semibold tracking-tight sm:text-[22px]">
            {t('profile.publicSpaceTitle', { name: displayName })}
          </h1>
          <span className="text-xs text-muted-foreground">@{profile.username}</span>
        </div>
        <p className="mt-1.5 hidden text-sm text-muted-foreground sm:block">
          {t('profile.publicSpaceDescription', { name: displayName })}
        </p>
      </div>

      <dl
        className="col-span-2 grid grid-cols-3 border-t pt-4 lg:col-span-1 lg:min-w-[330px] lg:border-l lg:border-t-0 lg:pt-0"
        aria-label={t('profile.statsLabel')}
      >
        <ProfileStat value={shares.length} label={t('profile.publicItems')} />
        <ProfileStat value={folders} label={t('profile.folders')} />
        <ProfileStat value={files} label={t('profile.files')} last />
      </dl>
    </section>
  )
}

function ProfileStat({ value, label, last = false }: { value: number; label: string; last?: boolean }) {
  return (
    <div className={`grid min-h-16 place-content-center justify-items-center px-3 ${last ? '' : 'border-r'}`}>
      <dd className="text-xl font-semibold tabular-nums tracking-tight">{value}</dd>
      <dt className="mt-1.5 text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center text-muted-foreground">
      <FolderIcon className="mb-3 size-10 opacity-30" />
      <p className="text-sm">{t('profile.noShares')}</p>
    </div>
  )
}

function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-[55vh] items-center justify-center text-muted-foreground" role="status">
      {t('common.loading')}
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

  if (profileQuery.isPending) return <LoadingState />

  if (profileQuery.isError) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">404</h1>
        <p className="text-muted-foreground">{t('profile.notFound')}</p>
      </div>
    )
  }

  const { user: profile, shares } = profileQuery.data

  return (
    <>
      <UserHeader profile={profile} shares={shares} />
      <section className="overflow-hidden rounded-xl border bg-background" aria-labelledby="public-files-title">
        <header className="flex min-h-[68px] items-center border-b px-4 sm:px-5">
          <div>
            <h2 id="public-files-title" className="text-sm font-semibold">
              {t('profile.publicContent')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('profile.itemCount', { count: shares.length })}</p>
          </div>
        </header>
        {shares.length === 0 ? <EmptyState /> : <ProfileShareTable shares={shares} />}
      </section>
    </>
  )
}

function ProfileShareTable({ shares }: { shares: PublicProfileShare[] }) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="hidden min-h-11 grid-cols-[minmax(0,1fr)_minmax(140px,0.35fr)_120px_28px] items-center gap-4 border-b px-5 text-xs font-medium text-muted-foreground min-[700px]:grid">
        <span>{t('profile.colName')}</span>
        <span>{t('profile.colType')}</span>
        <span>{t('profile.colSize')}</span>
        <span className="sr-only">{t('profile.open')}</span>
      </div>
      {shares.map((share) => (
        <ProfileShareRow key={share.token} share={share} />
      ))}
    </div>
  )
}

function ProfileShareRow({ share }: { share: PublicProfileShare }) {
  const { t } = useTranslation()
  const Icon = share.isFolder ? FolderIcon : FileIcon
  const typeLabel = share.isFolder ? t('profile.folder') : share.type

  return (
    <Link
      to="/s/$token"
      params={{ token: share.token }}
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_24px] items-center gap-2 border-b px-4 transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring min-[700px]:grid-cols-[minmax(0,1fr)_minmax(140px,0.35fr)_120px_28px] min-[700px]:gap-4 min-[700px]:px-5"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium">{share.name}</strong>
          <small className="mt-0.5 block truncate text-xs text-muted-foreground min-[700px]:hidden">{typeLabel}</small>
        </span>
      </span>
      <span className="hidden truncate text-sm text-muted-foreground min-[700px]:block">{typeLabel}</span>
      <span className="hidden text-sm tabular-nums text-muted-foreground min-[700px]:block">
        {share.isFolder || share.size == null ? '—' : formatSize(share.size)}
      </span>
      <span className="flex justify-end text-muted-foreground">
        <ChevronRight className="size-4" aria-hidden="true" />
        <span className="sr-only">{t('profile.open')}</span>
      </span>
    </Link>
  )
}
