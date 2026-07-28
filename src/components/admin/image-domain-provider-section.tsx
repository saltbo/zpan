import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, GlobeLock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getImageDomainProvider, saveImageDomainProvider, testImageDomainProvider } from '@/lib/api'

const queryKey = ['admin', 'image-domain-provider'] as const
type Provider = 'cloudflare_saas' | 'manual'
type RoutingMode = 'worker' | 'origin'

type FormState = {
  enabled: boolean
  provider: Provider
  apiToken: string
  zoneId: string
  routingMode: RoutingMode
  workerName: string
  originHostname: string
  cnameTarget: string
  records: string
}

const emptyForm: FormState = {
  enabled: false,
  provider: 'cloudflare_saas',
  apiToken: '',
  zoneId: '',
  routingMode: 'worker',
  workerName: 'zpan',
  originHostname: '',
  cnameTarget: '',
  records: 'CNAME images.example.com',
}

function toForm(data: Awaited<ReturnType<typeof getImageDomainProvider>> | undefined): FormState {
  if (!data || data.settings.provider === null) return emptyForm
  if (data.settings.provider === 'cloudflare_saas') {
    return {
      enabled: data.settings.enabled,
      provider: 'cloudflare_saas',
      apiToken: data.settings.cloudflare.apiToken,
      zoneId: data.settings.cloudflare.zoneId,
      routingMode: data.settings.cloudflare.routingMode,
      workerName:
        data.settings.cloudflare.routingMode === 'worker' ? data.settings.cloudflare.workerName : emptyForm.workerName,
      originHostname: data.settings.cloudflare.routingMode === 'origin' ? data.settings.cloudflare.originHostname : '',
      cnameTarget: data.settings.cloudflare.cnameTarget,
      records: emptyForm.records,
    }
  }
  return {
    ...emptyForm,
    enabled: data.settings.enabled,
    provider: 'manual',
    records: data.settings.manual.records.map((record) => `${record.type} ${record.value}`).join('\n'),
  }
}

function cloudflareTokenUrl(zoneId: string, routingMode: RoutingMode): string {
  const permissions = [
    { key: 'zone', type: 'read' },
    { key: 'dns', type: 'edit' },
    { key: 'ssl_and_certificates', type: 'edit' },
    ...(routingMode === 'worker'
      ? [
          { key: 'zone_transform_rules', type: 'edit' },
          { key: 'workers_routes', type: 'edit' },
        ]
      : []),
  ]
  const params = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(permissions),
    accountId: '*',
    zoneId: zoneId.trim() || 'all',
    name: 'ZPan Image Hosting',
  })
  return `https://dash.cloudflare.com/profile/api-tokens?${params}`
}

function parseRecords(value: string): Array<{ type: 'CNAME' | 'A' | 'AAAA'; value: string }> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawType, ...valueParts] = line.split(/\s+/)
      const type = rawType.toUpperCase()
      if ((type !== 'CNAME' && type !== 'A' && type !== 'AAAA') || valueParts.length === 0) {
        throw new Error(`Invalid DNS record: ${line}`)
      }
      return { type, value: valueParts.join(' ') }
    })
}

export function ImageDomainProviderSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const customDomainsEnabled = hasFeature('image_custom_domains')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const { data, isLoading } = useQuery({ queryKey, queryFn: getImageDomainProvider })

  useEffect(() => setForm(toForm(data)), [data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (form.provider === 'cloudflare_saas') {
        const routing =
          form.routingMode === 'worker'
            ? { routingMode: 'worker' as const, workerName: form.workerName.trim() }
            : { routingMode: 'origin' as const, originHostname: form.originHostname.trim() }
        return saveImageDomainProvider({
          enabled: form.enabled,
          provider: form.provider,
          cloudflare: {
            apiToken: form.apiToken,
            zoneId: form.zoneId.trim(),
            cnameTarget: form.cnameTarget.trim(),
            ...routing,
          },
        })
      }
      return saveImageDomainProvider({
        enabled: form.enabled,
        provider: form.provider,
        manual: { records: parseRecords(form.records) },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setOpen(false)
      toast.success(t('admin.imageDomains.saved'))
    },
    onError: (error) => toast.error(error.message),
  })

  const testMutation = useMutation({
    mutationFn: testImageDomainProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      toast.success(t('admin.imageDomains.testSucceeded'))
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey })
      toast.error(error.message)
    },
  })

  if (isLoading) {
    return (
      <Card data-settings-row className="rounded-lg border-border/70 py-0 shadow-xs">
        <CardContent className="p-4 text-muted-foreground text-sm">{t('common.loading')}</CardContent>
      </Card>
    )
  }

  const status = data?.status ?? 'disabled'
  const providerLabel =
    data?.settings.provider === 'cloudflare_saas'
      ? t('admin.imageDomains.cloudflare')
      : data?.settings.provider === 'manual'
        ? t('admin.imageDomains.manual')
        : t('admin.imageDomains.notConfigured')

  return (
    <>
      <Card data-settings-row className="rounded-lg border-border/70 py-0 shadow-xs">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <GlobeLock className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">{t('admin.imageDomains.title')}</CardTitle>
                <ProBadge tooltip={t('admin.imageDomains.proTooltip')} />
              </div>
              <CardDescription>{t('admin.imageDomains.description')}</CardDescription>
              <p className="text-muted-foreground text-sm">
                {providerLabel} · {t('admin.imageDomains.domainCount', { count: data?.domains.length ?? 0 })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={status === 'ready' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
              {t(`admin.imageDomains.status.${status}`)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={
                entitlementLoading || !customDomainsEnabled || !data?.settings.provider || testMutation.isPending
              }
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? t('common.loading') : t('admin.imageDomains.test')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={entitlementLoading || !customDomainsEnabled}
              onClick={() => setOpen(true)}
            >
              {t('common.edit')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {!entitlementLoading && !customDomainsEnabled && (
        <UpgradeHint
          feature="image_custom_domains"
          title={t('admin.imageDomains.upgradeTitle')}
          description={t('admin.imageDomains.upgradeDescription')}
        />
      )}

      <AdminFormDrawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setForm(toForm(data))
        }}
        title={t('admin.imageDomains.title')}
        description={t('admin.imageDomains.drawerDescription')}
        bodyClassName="grid auto-rows-min content-start gap-4"
        formProps={{
          onSubmit: (event) => {
            event.preventDefault()
            saveMutation.mutate()
          },
        }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex items-center justify-between gap-4">
          <AdminFormLabel htmlFor="imageDomainsEnabled" help={t('admin.imageDomains.enabledHelp')}>
            {t('admin.imageDomains.enabled')}
          </AdminFormLabel>
          <Switch
            id="imageDomainsEnabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
          />
        </div>

        <AdminFormField id="imageDomainProvider" label={t('admin.imageDomains.provider')} required>
          <Select
            value={form.provider}
            onValueChange={(provider: Provider) => setForm((current) => ({ ...current, provider }))}
          >
            <SelectTrigger id="imageDomainProvider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloudflare_saas">{t('admin.imageDomains.cloudflare')}</SelectItem>
              <SelectItem value="manual">{t('admin.imageDomains.manual')}</SelectItem>
            </SelectContent>
          </Select>
        </AdminFormField>

        {form.provider === 'cloudflare_saas' ? (
          <>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>{t('admin.imageDomains.cloudflareGuide')}</p>
              <Button asChild variant="link" className="h-auto px-0 py-2">
                <a href={cloudflareTokenUrl(form.zoneId, form.routingMode)} target="_blank" rel="noreferrer">
                  {t('admin.imageDomains.createToken')}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
              <p className="text-muted-foreground">{t('admin.imageDomains.tokenScopeHelp')}</p>
            </div>
            <AdminFormField
              id="cfApiToken"
              label={t('admin.imageDomains.apiToken')}
              help={t('admin.imageDomains.apiTokenHelp')}
              required
            >
              <Input
                id="cfApiToken"
                type="password"
                value={form.apiToken}
                onChange={(event) => setForm((current) => ({ ...current, apiToken: event.target.value }))}
              />
            </AdminFormField>
            <AdminFormField id="cfZoneId" label={t('admin.imageDomains.zoneId')} required>
              <Input
                id="cfZoneId"
                value={form.zoneId}
                onChange={(event) => setForm((current) => ({ ...current, zoneId: event.target.value }))}
              />
            </AdminFormField>
            <AdminFormField id="cfRoutingMode" label={t('admin.imageDomains.routingMode')} required>
              <Select
                value={form.routingMode}
                onValueChange={(routingMode: RoutingMode) => setForm((current) => ({ ...current, routingMode }))}
              >
                <SelectTrigger id="cfRoutingMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">{t('admin.imageDomains.routingModeWorker')}</SelectItem>
                  <SelectItem value="origin">{t('admin.imageDomains.routingModeOrigin')}</SelectItem>
                </SelectContent>
              </Select>
            </AdminFormField>
            {form.routingMode === 'worker' ? (
              <AdminFormField
                id="cfWorkerName"
                label={t('admin.imageDomains.workerName')}
                help={t('admin.imageDomains.workerNameHelp')}
                required
              >
                <Input
                  id="cfWorkerName"
                  value={form.workerName}
                  onChange={(event) => setForm((current) => ({ ...current, workerName: event.target.value }))}
                />
              </AdminFormField>
            ) : (
              <AdminFormField
                id="cfOriginHostname"
                label={t('admin.imageDomains.originHostname')}
                help={t('admin.imageDomains.originHostnameHelp')}
                required
              >
                <Input
                  id="cfOriginHostname"
                  placeholder="origin.example.com"
                  value={form.originHostname}
                  onChange={(event) => setForm((current) => ({ ...current, originHostname: event.target.value }))}
                />
              </AdminFormField>
            )}
            <AdminFormField id="cfCnameTarget" label={t('admin.imageDomains.cnameTarget')} required>
              <Input
                id="cfCnameTarget"
                placeholder="ssl.example.com"
                value={form.cnameTarget}
                onChange={(event) => setForm((current) => ({ ...current, cnameTarget: event.target.value }))}
              />
            </AdminFormField>
          </>
        ) : (
          <AdminFormField
            id="manualDnsRecords"
            label={t('admin.imageDomains.records')}
            help={t('admin.imageDomains.recordsHelp')}
            required
          >
            <Textarea
              id="manualDnsRecords"
              rows={5}
              value={form.records}
              onChange={(event) => setForm((current) => ({ ...current, records: event.target.value }))}
            />
          </AdminFormField>
        )}

        {data?.error && <p className="text-sm text-destructive">{data.error}</p>}
        {data?.domains.length ? (
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-medium text-sm">{t('admin.imageDomains.boundDomains')}</h4>
            {data.domains.map((domain) => (
              <div key={domain.orgId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-mono">{domain.hostname}</span>
                <Badge variant={domain.status === 'verified' ? 'default' : 'secondary'}>
                  {domain.status ?? 'pending_dns'}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </AdminFormDrawer>
    </>
  )
}
