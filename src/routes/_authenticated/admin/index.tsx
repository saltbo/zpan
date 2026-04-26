import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, ArrowRight, Database, Server, Settings, ShieldCheck, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listStorages, listUsers } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { t } = useTranslation()

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', { page: 1, limit: 1 }],
    queryFn: () => listUsers(1, 1),
  })

  const { data: storagesData } = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })

  const stats = [
    {
      title: t('admin.nav.users'),
      value: usersData?.total ?? '-',
      icon: Users,
      description: 'Total registered users',
      href: '/admin/users',
      color: 'text-blue-500',
    },
    {
      title: t('admin.nav.storages'),
      value: storagesData?.total ?? '-',
      icon: Database,
      description: 'Active storage backends',
      href: '/admin/storages',
      color: 'text-green-500',
    },
    {
      title: 'System Role',
      value: 'Administrator',
      icon: ShieldCheck,
      description: 'Full access permissions',
      color: 'text-purple-500',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{t('admin.title')} Overview</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
              {stat.href && (
                <Button variant="ghost" size="sm" className="mt-4 h-8 px-2 text-xs" asChild>
                  <Link to={stat.href}>
                    View Details
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/admin/users">
                <Users className="mr-2 h-4 w-4" />
                Manage Users
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/admin/storages">
                <Database className="mr-2 h-4 w-4" />
                Configure Storage
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/admin/settings">
                <Settings className="mr-2 h-4 w-4" />
                System Settings
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/admin/settings/auth">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Auth Configuration
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>System Information</CardTitle>
            <CardDescription>Server and Environment</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <Server className="h-4 w-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Environment</p>
                  <p className="text-xs text-muted-foreground">Production</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-green-500/10 p-2 text-green-500">
                  <Activity className="h-4 w-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Status</p>
                  <p className="text-xs text-muted-foreground">System is running normally</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
