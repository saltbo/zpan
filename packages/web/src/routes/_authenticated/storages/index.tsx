import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/storages/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings' })
  },
  component: () => null,
})
