import { createFileRoute } from '@tanstack/react-router'
import { UserTable } from '@/features/admin/components/user-table'

export const Route = createFileRoute('/_authenticated/admin/users/')({
  component: AdminUsersPage,
})

function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <UserTable />
    </div>
  )
}
