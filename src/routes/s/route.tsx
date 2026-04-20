import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ShareLayout } from '@/components/share/share-layout'
import { ShareLayoutProvider, useShareLayoutState } from '@/components/share/share-layout-state'

export const Route = createFileRoute('/s')({
  component: ShareRouteLayout,
})

function ShareRouteLayout() {
  return (
    <ShareLayoutProvider>
      <ShareRouteFrame />
    </ShareLayoutProvider>
  )
}

function ShareRouteFrame() {
  const { layout } = useShareLayoutState()

  return (
    <ShareLayout title={layout.title} subtitle={layout.subtitle} meta={layout.meta}>
      <Outlet />
    </ShareLayout>
  )
}
