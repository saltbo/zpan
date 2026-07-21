import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/admin/')({
  beforeLoad: redirectToAdminDashboard,
})

export function redirectToAdminDashboard() {
  throw redirect({ to: '/admin/dashboard' })
}
