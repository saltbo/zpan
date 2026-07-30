import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listAuthProviders } from '@/lib/api'

const providersQueryKey = ['admin', 'auth-providers'] as const

export function RegisteredOAuthApplicationsSection() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: providersQueryKey,
    queryFn: listAuthProviders,
  })
  const applications = data?.registeredApplications ?? []

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-lg">{t('admin.auth.registeredApplications')}</h2>
        <p className="text-muted-foreground text-sm">{t('admin.auth.registeredApplicationsDescription')}</p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : applications.length === 0 ? (
        <div className="rounded-md border px-4 py-10 text-center text-muted-foreground text-sm">
          {t('admin.auth.noRegisteredApplications')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t('admin.auth.application')}</TableHead>
                <TableHead>{t('admin.auth.clientId')}</TableHead>
                <TableHead>{t('admin.auth.redirectUri')}</TableHead>
                <TableHead>{t('admin.auth.grants')}</TableHead>
                <TableHead>{t('admin.auth.enabled')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => (
                <TableRow key={application.clientId}>
                  <TableCell className="font-medium">{application.name}</TableCell>
                  <TableCell className="max-w-52 truncate font-mono text-xs" title={application.clientId}>
                    {application.clientId}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-xs" title={application.redirectUris.join(', ')}>
                    {application.redirectUris.join(', ')}
                  </TableCell>
                  <TableCell className="max-w-72 text-xs">{application.grantTypes.join(', ')}</TableCell>
                  <TableCell>
                    {application.disabled ? t('admin.auth.statusDisabled') : t('admin.auth.statusEnabled')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
