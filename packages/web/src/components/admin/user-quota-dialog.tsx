import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface UserQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; orgId: string; quotaUsed: number; quotaTotal: number } | null
}

const BYTES_PER_GB = 1024 * 1024 * 1024

export function UserQuotaDialog({ open, onOpenChange, user }: UserQuotaDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [quotaGB, setQuotaGB] = useState('')

  useEffect(() => {
    if (open && user) {
      const gb = user.quotaTotal > 0 ? parseFloat((user.quotaTotal / BYTES_PER_GB).toFixed(2)) : ''
      setQuotaGB(String(gb))
    }
  }, [open, user])

  const mutation = useMutation({
    mutationFn: async ({ orgId, quota }: { orgId: string; quota: number }) => {
      const res = await fetch(`/api/admin/quotas/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quota }),
      })
      if (!res.ok) throw new Error('Failed to update quota')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] })
      onOpenChange(false)
      toast.success(t('admin.users.quotaUpdated'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setQuotaGB('')
    onOpenChange(nextOpen)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const value = Number(quotaGB)
    if (Number.isNaN(value) || value < 0) return
    mutation.mutate({ orgId: user.orgId, quota: Math.round(value * BYTES_PER_GB) })
  }

  if (!user) return null

  const usedGB = (user.quotaUsed / BYTES_PER_GB).toFixed(2)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.setQuotaFor', { name: user.name })}</DialogTitle>
          <DialogDescription>{t('admin.users.currentUsage', { used: usedGB })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quota">{t('admin.users.quotaLabel')}</Label>
            <Input
              id="quota"
              type="number"
              min="0"
              step="0.1"
              value={quotaGB}
              onChange={(e) => setQuotaGB(e.target.value)}
              placeholder="10"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
