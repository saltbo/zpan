import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Loader2 } from 'lucide-react'
import { useUpdateUser, type User } from '../api'
import { toast } from 'sonner'

const GB = 1024 * 1024 * 1024

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
  const update = useUpdateUser()

  const form = useForm<FormValues>({
    defaultValues: {
      role: 'member',
      banned: false,
      quota: 0,
    },
  })

  useEffect(() => {
    if (user) {
      form.reset({
        role: user.role,
        banned: user.banned,
        quota: Math.round(user.quota / GB),
      })
    }
  }, [user, form])

  async function onSubmit(values: FormValues) {
    if (!user) return
    await update.mutateAsync({
      id: user.id,
      data: {
        role: values.role,
        banned: values.banned,
        quota: values.quota * GB,
      },
    })
    toast.success('User updated')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Update role, status, and quota for {user?.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-2">
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
            <Label>Banned</Label>
            <Switch
              checked={form.watch('banned')}
              onCheckedChange={(v) => form.setValue('banned', v)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Storage Quota (GB)</Label>
            <Input type="number" {...form.register('quota', { valueAsNumber: true })} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
