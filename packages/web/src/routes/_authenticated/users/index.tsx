import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/users/')({
  component: UsersPage,
})

function UsersPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Users className="h-16 w-16" />
      <h2 className="text-xl font-medium">Users</h2>
      <p className="text-sm">User management will be implemented here.</p>
    </div>
  )
}
