import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useUpdateUser, type AdminUser } from '@/features/admin/api'

const GB = 1024 * 1024 * 1024

interface UserEditDialogProps {
  user: AdminUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserEditDialog({ user, open, onOpenChange }: UserEditDialogProps) {
  const [role, setRole] = useState('user')
  const [banned, setBanned] = useState(false)
  const [quotaGB, setQuotaGB] = useState('')
  const updateUser = useUpdateUser()

  useEffect(() => {
    if (open && user) {
      setRole(user.role)
      setBanned(user.banned)
      setQuotaGB(user.quota ? String(user.quota.quota / GB) : '')
    }
  }, [open, user])

  function handleSave() {
    if (!user) return

    const body: { id: string; role?: string; banned?: boolean; quota?: number } = {
      id: user.id,
    }

    if (role !== user.role) body.role = role
    if (banned !== user.banned) body.banned = banned
    if (quotaGB) body.quota = Number(quotaGB) * GB

    updateUser.mutate(body, {
      onSuccess: () => {
        toast.success('User updated')
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit User — {user?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="user">Member</option>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Banned</Label>
            <Switch checked={banned} onCheckedChange={setBanned} />
          </div>

          <div className="space-y-1.5">
            <Label>Storage Quota (GB)</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={quotaGB}
              onChange={(e) => setQuotaGB(e.target.value)}
              placeholder="Leave empty to keep current"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateUser.isPending}>
            {updateUser.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
