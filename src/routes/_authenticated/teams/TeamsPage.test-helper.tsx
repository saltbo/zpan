// Test helper: re-exports the TeamsPage component so tests can render it
// directly without going through TanStack Router's createFileRoute() binding.
//
// This file is intentionally NOT the source module — it exists only to let
// test code import the component after all vi.mock() declarations have been
// set up, avoiding circular module-init ordering issues with createFileRoute.

import { useQueries } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getFullOrganization, useListOrganizations, useSession } from '@/lib/auth-client'

type ListOrganization = {
  id: string
  slug: string
}

function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0">
        <UpgradeHint feature="teams_unlimited" />
      </DialogContent>
    </Dialog>
  )
}

export function TeamsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: orgs } = useListOrganizations()
  const { hasFeature } = useEntitlement()
  const [createOpen, setCreateOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const _userId = session?.user?.id ?? ''
  const teamOrgs = (orgs ?? []).filter((o: ListOrganization) => !o.slug.startsWith('personal-'))

  const totalOrgCount = (orgs ?? []).length
  const isAtLimit = !hasFeature('teams_unlimited') && totalOrgCount >= 3

  useQueries({
    queries: teamOrgs.map((o: ListOrganization) => ({
      queryKey: ['organization', 'full', o.id],
      queryFn: async () => {
        const { data, error } = await getFullOrganization({ query: { organizationId: o.id } })
        if (error) throw error
        return data
      },
    })),
  })

  function handleNewTeamClick() {
    if (isAtLimit) {
      setUpgradeOpen(true)
    } else {
      setCreateOpen(true)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        items={[
          {
            label: t('teams.title'),
            icon: <Users className="size-4 text-muted-foreground" />,
          },
        ]}
        actions={
          <Button onClick={handleNewTeamClick} size="sm" data-testid="new-team-btn">
            <span className="sr-only sm:not-sr-only">{t('teams.createNew')}</span>
            {isAtLimit && <ProBadge className="ml-1" />}
          </Button>
        }
      />

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      {createOpen && <div data-testid="create-team-dialog">CreateTeamDialog</div>}
    </div>
  )
}
