import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateUser, type User } from '../api'

interface FormValues {
  role: string
  banned: boolean
  quota: number
}

interface UserEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
}

export function UserEditDialog({ open, onOpenChange, user }: UserEditDialogProps) {
  const updateMutation = useUpdateUser()

  const form = useForm<FormValues>({
    defaultValues: { role: 'member', banned: false, quota: 0 },
  })

  useEffect(() => {
    if (user) {
      form.reset({
        role: user.role,
        banned: user.banned,
        quota: user.quota ? Math.round(user.quota.quota / 1073741824) : 0,
      })
    }
  }, [user, form])

  function handleSubmit(values: FormValues) {
    if (!user) return
    updateMutation.mutate(
      {
        id: user.id,
        role: values.role,
        banned: values.banned,
        quota: values.quota * 1073741824,
      },
      {
        onSuccess: () => {
          toast.success('User updated')
          onOpenChange(false)
        },
        onError: (err) => toast.error(err.message || 'Failed to update user'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User — {user?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="banned">Banned</Label>
            <Switch
              id="banned"
              checked={form.watch('banned')}
              onCheckedChange={(v) => form.setValue('banned', !!v)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Storage Quota (GB)</Label>
            <Input type="number" min={0} {...form.register('quota', { valueAsNumber: true })} />
            <p className="text-xs text-muted-foreground">Set to 0 for unlimited</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
