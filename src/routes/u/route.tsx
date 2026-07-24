import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PublicLayout } from '@/components/layout/public-layout'

export const Route = createFileRoute('/u')({
  component: PublicProfileLayout,
})

function PublicProfileLayout() {
  return (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  )
}
