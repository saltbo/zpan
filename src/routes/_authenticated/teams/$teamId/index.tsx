import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/teams/$teamId/')({
  beforeLoad: ({ params: { teamId } }) => {
    throw redirect({ to: '/teams/$teamId/members', params: { teamId } })
  },
  component: () => null,
})
