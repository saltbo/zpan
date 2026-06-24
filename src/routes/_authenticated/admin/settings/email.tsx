import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/admin/settings/email')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings' })
  },
})
