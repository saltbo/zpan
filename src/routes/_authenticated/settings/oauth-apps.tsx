import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PanelRightOpen, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthScopeList } from '@/components/oauth-scope-list'
import { Badge } from '@/components/ui/badge'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listOAuthGrants, type OAuthGrant, revokeOAuthGrant } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/settings/oauth-apps')({
  component: OAuthAppsSettingsPage,
})

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null
}

function workspaceNames(grant: OAuthGrant) {
  return grant.workspaces.map((workspace) => workspace.name ?? workspace.id).join(', ')
}

function OAuthGrantDetailsSheet({ grant, onClose }: { grant: OAuthGrant | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (grantId: string) => revokeOAuthGrant(grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-grants'] })
      setConfirming(false)
      onClose()
    },
    onError: (error) => setRevokeError(error.message),
  })

  function closeSheet() {
    if (mutation.isPending) return
    setConfirming(false)
    setRevokeError(null)
    onClose()
  }

  return (
    <>
      <Sheet open={grant !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          {grant ? (
            <>
              <SheetHeader className="pr-12">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="truncate">{grant.clientName}</SheetTitle>
                    <SheetDescription>{t('settings.oauthApps.detailsDescription')}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 px-4 pb-4">
                  <dl className="grid gap-4 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <dt className="text-muted-foreground">{t('settings.oauthApps.clientId')}</dt>
                      <dd className="break-all font-mono text-xs">{grant.clientId}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">{t('settings.oauthApps.colWorkspace')}</dt>
                      <dd className="font-medium">{workspaceNames(grant)}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">{t('settings.oauthApps.status')}</dt>
                      <dd>
                        <Badge variant="secondary">{t('settings.oauthApps.statusActive')}</Badge>
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">{t('settings.oauthApps.colCreated')}</dt>
                      <dd>{formatDate(grant.createdAt)}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground">{t('settings.oauthApps.colLastUsed')}</dt>
                      <dd>{formatDate(grant.lastUsedAt) ?? t('settings.oauthApps.never')}</dd>
                    </div>
                  </dl>

                  <Separator />

                  <section className="space-y-3" aria-labelledby="oauth-grant-permissions">
                    <div>
                      <h2 id="oauth-grant-permissions" className="font-semibold">
                        {t('settings.oauthApps.oauthPermissions')}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t('settings.oauthApps.permissionCount', { count: grant.scopes.length })}
                      </p>
                    </div>
                    <OAuthScopeList scopes={grant.scopes} />
                  </section>
                </div>
              </ScrollArea>

              <SheetFooter className="border-t">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setRevokeError(null)
                    setConfirming(true)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t('settings.oauthApps.revokeAccess')}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={confirming} onOpenChange={(open) => !mutation.isPending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.oauthApps.oauthGrantRevokeTitle')}</DialogTitle>
            <DialogDescription>
              {grant
                ? t('settings.oauthApps.oauthGrantRevokeConfirm', {
                    client: grant.clientName,
                    workspace: workspaceNames(grant),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          {revokeError ? <p className="text-sm text-destructive">{revokeError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(grant!.id)}
            >
              {mutation.isPending ? t('common.loading') : t('settings.oauthApps.revokeAccess')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function OAuthGrants() {
  const { t } = useTranslation()
  const [selectedGrant, setSelectedGrant] = useState<OAuthGrant | null>(null)
  const query = useQuery({ queryKey: ['oauth-grants'], queryFn: listOAuthGrants })
  const grants = query.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.oauthApps.oauthGrantsSection')}</CardTitle>
        <CardDescription>{t('settings.oauthApps.oauthGrantsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-destructive">{t('settings.oauthApps.oauthGrantsError')}</p>
        ) : grants.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.oauthApps.oauthNoGrants')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.oauthApps.oauthClient')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('settings.oauthApps.colWorkspace')}</TableHead>
                <TableHead>{t('settings.oauthApps.colScopes')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('settings.oauthApps.colCreated')}</TableHead>
                <TableHead className="hidden xl:table-cell">{t('settings.oauthApps.colLastUsed')}</TableHead>
                <TableHead className="w-10 text-right sm:w-28">
                  <span className="sr-only sm:not-sr-only">{t('settings.oauthApps.colActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="max-w-32 truncate font-medium sm:max-w-none">{grant.clientName}</TableCell>
                  <TableCell className="hidden md:table-cell">{workspaceNames(grant)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <span className="sm:hidden">{grant.scopes.length}</span>
                      <span className="hidden sm:inline">
                        {t('settings.oauthApps.permissionCount', { count: grant.scopes.length })}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(grant.createdAt)}</TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {formatDate(grant.lastUsedAt) ?? t('settings.oauthApps.never')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="size-8 px-0 sm:w-auto sm:px-3"
                      onClick={() => setSelectedGrant(grant)}
                    >
                      <PanelRightOpen className="size-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">{t('settings.oauthApps.viewDetails')}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <OAuthGrantDetailsSheet grant={selectedGrant} onClose={() => setSelectedGrant(null)} />
    </Card>
  )
}

export function OAuthAppsSettingsPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <OAuthGrants />
    </div>
  )
}
