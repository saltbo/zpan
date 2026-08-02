import { oauthResourceScopeLabels } from '@shared/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listOAuthGrants, type OAuthGrant, revokeOAuthGrant } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/settings/oauth-apps')({
  component: OAuthAppsSettingsPage,
})

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null
}

function RevokeGrantDialog({ grant, onClose }: { grant: OAuthGrant | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      if (grant) await revokeOAuthGrant(grant.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-grants'] })
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })
  if (!grant) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.oauthApps.oauthGrantRevokeTitle')}</DialogTitle>
          <DialogDescription>
            {t('settings.oauthApps.oauthGrantRevokeConfirm', {
              client: grant.clientName,
              workspace: grant.workspaces.map((workspace) => workspace.name ?? workspace.id).join(', '),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            <Trash2 className="size-4" />
            {mutation.isPending ? t('common.loading') : t('settings.oauthApps.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OAuthGrants() {
  const { t } = useTranslation()
  const [revoking, setRevoking] = useState<OAuthGrant | null>(null)
  const query = useQuery({ queryKey: ['oauth-grants'], queryFn: listOAuthGrants })
  const grants = query.data?.items ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.oauthApps.oauthGrantsSection')}</CardTitle>
        <CardDescription>{t('settings.oauthApps.oauthGrantsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
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
                <TableHead>{t('settings.oauthApps.colWorkspace')}</TableHead>
                <TableHead>{t('settings.oauthApps.colScopes')}</TableHead>
                <TableHead>{t('settings.oauthApps.colCreated')}</TableHead>
                <TableHead>{t('settings.oauthApps.colLastUsed')}</TableHead>
                <TableHead className="w-20 text-right">{t('settings.oauthApps.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="font-medium">{grant.clientName}</TableCell>
                  <TableCell>
                    {grant.workspaces.map((workspace) => workspace.name ?? workspace.id).join(', ')}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {grant.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {t(oauthResourceScopeLabels[scope])}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(grant.createdAt)}</TableCell>
                  <TableCell>{formatDate(grant.lastUsedAt) ?? t('settings.oauthApps.never')}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('settings.oauthApps.revoke')}
                      onClick={() => setRevoking(grant)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <RevokeGrantDialog grant={revoking} onClose={() => setRevoking(null)} />
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
