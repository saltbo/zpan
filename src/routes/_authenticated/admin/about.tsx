import { githubCommitUrl, ZPAN_CLOUD_URL_DEFAULT, ZPAN_GITHUB_URL } from '@shared/constants'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowUpCircle, BadgeCheck, ExternalLink, Github, Server, Sparkles, Star } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ChangelogMarkdown } from '@/components/admin/changelog-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getChangelog, getInstanceInfo } from '@/lib/api'
import { EDITION_COLORS, editionKey } from '@/lib/license-edition'

export const Route = createFileRoute('/_authenticated/admin/about')({
  component: AboutPage,
})

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-all">{children}</span>
    </div>
  )
}

function AboutPage() {
  const { t } = useTranslation()
  const { bound, active, edition, licenseId, cloudDashboardUrl } = useEntitlement()
  const [changelogOpen, setChangelogOpen] = useState(false)
  const { data: instance, isLoading } = useQuery({
    queryKey: ['system', 'instance'],
    queryFn: getInstanceInfo,
    staleTime: 5 * 60 * 1000,
  })
  const { data: changelog, isError: changelogError } = useQuery({
    queryKey: ['system', 'changelog'],
    queryFn: getChangelog,
    staleTime: 60 * 60 * 1000,
  })

  if (isLoading || !instance) return null

  const key = editionKey(bound, edition)
  const editionLabel = t(`admin.licenseRibbon.${key}`)
  const runtime = instance.runtime
  const os = instance.server?.os

  // When the instance holds a valid license, deep-link the cloud CTA straight to
  // the certificate detail page; otherwise nudge toward upgrading.
  const cloudBase = cloudDashboardUrl?.replace(/\/dashboard\/?$/, '') ?? ZPAN_CLOUD_URL_DEFAULT
  const authorized = bound && active && Boolean(licenseId)
  const cloudUrl = authorized ? `${cloudBase}/licenses/${licenseId}` : (cloudDashboardUrl ?? ZPAN_CLOUD_URL_DEFAULT)

  return (
    <div className="max-w-2xl space-y-6">
      <AdminPageHeader
        title={t('admin.about.title')}
        description={t('admin.about.subtitle')}
        badge={<Badge variant="secondary">v{instance.version}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            {t('admin.about.instanceTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label={t('admin.about.instanceName')}>{instance.name}</InfoRow>
          <InfoRow label={t('admin.about.instanceId')}>
            <code className="text-xs">{instance.id}</code>
          </InfoRow>
          <InfoRow label={t('admin.about.url')}>
            <a
              href={instance.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {instance.url}
              <ExternalLink className="h-3 w-3" />
            </a>
          </InfoRow>
          <InfoRow label={t('admin.about.version')}>
            <span className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                className="font-medium hover:text-primary hover:underline"
              >
                v{instance.version}
              </button>
              {changelog &&
                (changelog.updateAvailable ? (
                  <Badge
                    onClick={() => setChangelogOpen(true)}
                    title={t('admin.about.latestVersion')}
                    className="cursor-pointer border-transparent bg-[#1A73E8] text-white"
                  >
                    <ArrowUpCircle />
                    {changelog.latestVersion ? `v${changelog.latestVersion}` : t('admin.about.updateAvailable')}
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    onClick={() => setChangelogOpen(true)}
                    title={t('admin.about.latestVersion')}
                    className="cursor-pointer"
                  >
                    {t('admin.about.upToDate')}
                  </Badge>
                ))}
            </span>
          </InfoRow>
          {instance.commit && (
            <InfoRow label={t('admin.about.commit')}>
              <a
                href={githubCommitUrl(instance.commit)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                title={t('admin.about.commitTooltip')}
              >
                {instance.commit}
                <ExternalLink className="h-3 w-3" />
              </a>
            </InfoRow>
          )}
          <InfoRow label={t('admin.about.edition')}>
            <Badge style={{ backgroundColor: EDITION_COLORS[key], color: '#fff' }} className="border-transparent">
              {editionLabel}
            </Badge>
            {bound && !active && (
              <span className="ml-2 text-xs text-muted-foreground">{t('admin.about.inactive')}</span>
            )}
          </InfoRow>
          {runtime && (
            <InfoRow label={t('admin.about.runtime')}>
              {runtime.provider} · {runtime.target}
            </InfoRow>
          )}
          {os && (
            <InfoRow label={t('admin.about.server')}>
              {[os.platform, os.arch, os.release].filter(Boolean).join(' · ')}
            </InfoRow>
          )}
          {instance.node?.version && <InfoRow label={t('admin.about.nodeVersion')}>{instance.node.version}</InfoRow>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Github className="h-4 w-4" />
              {t('admin.about.github.title')}
            </CardTitle>
            <CardDescription>{t('admin.about.github.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <a href={ZPAN_GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Star className="mr-2 h-4 w-4" />
                {t('admin.about.github.cta')}
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {authorized ? <BadgeCheck className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {t('admin.about.cloud.title')}
            </CardTitle>
            <CardDescription>
              {t(authorized ? 'admin.about.cloud.descriptionBound' : 'admin.about.cloud.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" style={{ backgroundColor: '#1A73E8' }} asChild>
              <a href={cloudUrl} target="_blank" rel="noopener noreferrer">
                {authorized ? <BadgeCheck className="mr-2 h-4 w-4" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                {t(authorized ? 'admin.about.cloud.viewCert' : 'admin.about.cloud.cta')}
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Sheet open={changelogOpen} onOpenChange={setChangelogOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('admin.about.changelogTitle')}</SheetTitle>
            <SheetDescription>{t('admin.about.changelogSubtitle')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {changelogError ? (
              <p className="text-sm text-muted-foreground">{t('admin.about.changelogError')}</p>
            ) : changelog ? (
              <ChangelogMarkdown content={changelog.markdown} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
