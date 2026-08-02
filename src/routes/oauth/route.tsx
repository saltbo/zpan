import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SessionGateError, SessionGatePending } from '@/components/auth/session-gate'
import { getSession } from '@/lib/api'

export const Route = createFileRoute('/oauth')({
  beforeLoad: async ({ location }) => {
    const data = await getSession()
    if (!data?.session) {
      const redirectUrl = encodeURIComponent(`${location.pathname}${location.searchStr ?? ''}`)
      throw redirect({ to: '/sign-in', search: { redirect: redirectUrl } as never })
    }
    return { user: data.user }
  },
  pendingComponent: SessionGatePending,
  errorComponent: SessionGateError,
  component: OAuthLayout,
})

function OAuthLayout() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-10 sm:py-16">
      <Outlet />
    </main>
  )
}
