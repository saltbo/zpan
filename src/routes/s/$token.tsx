import { createFileRoute } from '@tanstack/react-router'
import { ShareLanding } from '@/components/share/share-landing'

export const Route = createFileRoute('/s/$token')({
  component: SharePage,
})

function SharePage() {
  const { token } = Route.useParams()
  return <ShareLanding token={token} />
}
