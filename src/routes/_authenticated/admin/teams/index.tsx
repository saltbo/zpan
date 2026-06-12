import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { listTeams, type TeamSummary } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/teams/')({
  component: TeamsPage,
})

function TeamsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const teamsQuery = useQuery({ queryKey: ['admin', 'teams'], queryFn: listTeams })
  const teams = teamsQuery.data?.items ?? []

  if (teamsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t('admin.teams.title')}</h2>
        <span className="text-sm text-muted-foreground">{t('admin.teams.count', { count: teams.length })}</span>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-[34%] px-4 py-3 text-left font-medium">{t('admin.teams.colName')}</th>
              <th className="hidden w-[22%] px-4 py-3 text-left font-medium sm:table-cell">
                {t('admin.teams.colOwner')}
              </th>
              <th className="w-[14%] px-4 py-3 text-left font-medium">{t('admin.teams.colMembers')}</th>
              <th className="hidden w-[18%] px-4 py-3 text-left font-medium md:table-cell">
                {t('admin.teams.colUsage')}
              </th>
              <th className="hidden w-[12%] px-4 py-3 text-left font-medium lg:table-cell">
                {t('admin.teams.colCreatedAt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <TeamTableRow
                key={team.id}
                team={team}
                onOpen={() => navigate({ to: '/admin/teams/$orgId', params: { orgId: team.id } })}
              />
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {t('admin.teams.noTeams')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TeamTableRow({ team, onOpen }: { team: TeamSummary; onOpen: () => void }) {
  const { t } = useTranslation()

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">
        <button type="button" className="flex min-w-0 items-center gap-3 text-left hover:text-primary" onClick={onOpen}>
          <Avatar className="h-7 w-7 shrink-0">
            {team.logo && <AvatarImage src={team.logo} alt={team.name} />}
            <AvatarFallback className="text-xs">{getInitials(team.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate" title={team.name}>
            {team.name}
          </span>
        </button>
      </td>
      <td className="hidden truncate px-4 py-3 text-muted-foreground sm:table-cell" title={team.ownerName ?? ''}>
        {team.ownerName ?? '—'}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
        {t('admin.teams.memberCount', { count: team.memberCount })}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">
        {formatUsage(team.quotaUsed, team.quotaTotal)}
      </td>
      <td className="hidden truncate px-4 py-3 text-muted-foreground lg:table-cell" title={formatDate(team.createdAt)}>
        {formatDate(team.createdAt)}
      </td>
    </tr>
  )
}

function formatUsage(used: number, total: number): string {
  if (total <= 0) return `${formatSize(used)} / ∞`
  return `${formatSize(used)} / ${formatSize(total)}`
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
