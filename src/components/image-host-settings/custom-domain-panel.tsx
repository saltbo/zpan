import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IhostConfigResponse } from '@/lib/api'
import { updateIhostConfig } from '@/lib/api'

const POLL_INTERVAL_MS = 10_000
const MAX_POLLS = 6
const IHOST_CONFIG_QUERY_KEY = (orgId: string) => ['ihost', 'config', orgId] as const

const hostnameRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2 text-xs">
      {copied ? t('settings.ihost.customDomain.copied') : 'Copy'}
    </Button>
  )
}

function DnsInstructions({ config }: { config: IhostConfigResponse }) {
  const { t } = useTranslation()
  const dns = config.dnsInstructions
  if (!dns) return null

  if (dns.recordType === 'manual') {
    return (
      <div className="rounded-md border bg-muted/50 p-4 space-y-2">
        <p className="text-sm font-medium">{t('settings.ihost.customDomain.manualTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('settings.ihost.customDomain.manualInstructions')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-muted/50 p-4 space-y-3">
      <p className="text-sm font-medium">{t('settings.ihost.customDomain.dnsTitle')}</p>
      <p className="text-sm text-muted-foreground">{t('settings.ihost.customDomain.dnsInstructions')}</p>
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 items-center text-sm">
        <span className="text-muted-foreground">{t('settings.ihost.customDomain.dnsType')}</span>
        <span className="font-mono">{dns.recordType}</span>
        <div />
        <span className="text-muted-foreground">{t('settings.ihost.customDomain.dnsName')}</span>
        <span className="font-mono break-all">{dns.name}</span>
        <CopyButton value={dns.name} />
        <span className="text-muted-foreground">{t('settings.ihost.customDomain.dnsTarget')}</span>
        <span className="font-mono break-all">{dns.target}</span>
        <CopyButton value={dns.target} />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: IhostConfigResponse['domainStatus'] }) {
  const { t } = useTranslation()
  const styles = {
    verified: 'bg-green-100 text-green-800',
    pending: 'bg-amber-100 text-amber-800',
    none: 'bg-gray-100 text-gray-600',
  }
  const labels = {
    verified: t('settings.ihost.customDomain.statusVerified'),
    pending: t('settings.ihost.customDomain.statusPending'),
    none: t('settings.ihost.customDomain.statusNone'),
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>
  )
}

interface CustomDomainPanelProps {
  orgId: string
  config: IhostConfigResponse
}

export function CustomDomainPanel({ orgId, config }: CustomDomainPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [domain, setDomain] = useState(config.customDomain ?? '')
  const [domainError, setDomainError] = useState('')
  const [removeOpen, setRemoveOpen] = useState(false)
  const pollCountRef = useRef(0)
  const [pollingStopped, setPollingStopped] = useState(false)

  // Auto-poll when domain is pending verification
  useEffect(() => {
    if (config.domainStatus !== 'pending') {
      pollCountRef.current = 0
      setPollingStopped(false)
      return
    }

    if (pollCountRef.current >= MAX_POLLS) {
      setPollingStopped(true)
      return
    }

    const timer = setInterval(() => {
      pollCountRef.current += 1
      if (pollCountRef.current >= MAX_POLLS) {
        clearInterval(timer)
        setPollingStopped(true)
        return
      }
      queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [config.domainStatus, orgId, queryClient])

  const saveMutation = useMutation({
    mutationFn: (newDomain: string | null) => updateIhostConfig({ customDomain: newDomain }),
    onSuccess: (updated) => {
      toast.success(
        updated.customDomain ? t('settings.ihost.customDomain.saved') : t('settings.ihost.customDomain.removed'),
      )
      pollCountRef.current = 0
      setPollingStopped(false)
      queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
    },
    onError: (err) => toast.error(err.message),
  })

  function validateDomain(value: string): boolean {
    if (!value) {
      setDomainError(t('settings.ihost.customDomain.invalidHostname'))
      return false
    }
    if (!hostnameRegex.test(value)) {
      setDomainError(t('settings.ihost.customDomain.invalidHostname'))
      return false
    }
    setDomainError('')
    return true
  }

  function handleSave() {
    if (!validateDomain(domain)) return
    saveMutation.mutate(domain)
  }

  function handleRemove() {
    setRemoveOpen(false)
    setDomain('')
    saveMutation.mutate(null)
  }

  function handleRefresh() {
    pollCountRef.current = 0
    setPollingStopped(false)
    queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
  }

  const isDirty = domain !== (config.customDomain ?? '')

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.ihost.customDomain.section')}</CardTitle>
          <CardDescription>{t('settings.ihost.customDomain.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="customDomain">{t('settings.ihost.customDomain.label')}</Label>
            <div className="flex gap-2">
              <Input
                id="customDomain"
                placeholder={t('settings.ihost.customDomain.placeholder')}
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value)
                  setDomainError('')
                }}
              />
              <Button onClick={handleSave} disabled={!isDirty || saveMutation.isPending}>
                {saveMutation.isPending ? t('common.loading') : t('settings.ihost.customDomain.save')}
              </Button>
            </div>
            {domainError && <p className="text-xs text-destructive">{domainError}</p>}
          </div>

          {config.customDomain && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <StatusBadge status={config.domainStatus} />
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={saveMutation.isPending}>
                  {t('settings.ihost.customDomain.refresh')}
                </Button>
              </div>

              {pollingStopped && config.domainStatus === 'pending' && (
                <p className="text-xs text-muted-foreground">{t('settings.ihost.customDomain.pollingStopped')}</p>
              )}

              {config.domainStatus !== 'verified' && <DnsInstructions config={config} />}

              {config.domainStatus === 'verified' && (
                <Button variant="destructive" size="sm" onClick={() => setRemoveOpen(true)}>
                  {t('settings.ihost.customDomain.remove')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.ihost.customDomain.remove')}</DialogTitle>
            <DialogDescription>{t('settings.ihost.customDomain.removeConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.loading') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
