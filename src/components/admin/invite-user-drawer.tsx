import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, MailPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { createSiteInvitation } from '@/lib/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

interface InviteUserDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited?: () => void
}

export function InviteUserDrawer({ open, onOpenChange, onInvited }: InviteUserDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')

  const createMutation = useMutation({
    mutationFn: (nextEmail: string) => createSiteInvitation(nextEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteCreated'))
      handleOpenChange(false)
      onInvited?.()
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setEmail('')
      createMutation.reset()
    }
  }

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={handleOpenChange}
      title={t('admin.users.inviteDialogTitle')}
      description={t('admin.users.inviteDialogDescription')}
      bodyClassName="grid auto-rows-min content-start gap-4"
      formProps={{
        onSubmit: (event) => {
          event.preventDefault()
          createMutation.mutate(email.trim())
        },
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={createMutation.isPending || !email.trim()}>
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : <MailPlus />}
            {t('admin.users.sendInvite')}
          </Button>
        </>
      }
    >
      <AdminFormField
        id="invite-email"
        label={t('admin.users.inviteEmail')}
        required
        error={createMutation.error?.message}
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (createMutation.isError) createMutation.reset()
          }}
          placeholder={t('admin.users.inviteEmailPlaceholder')}
          required
        />
      </AdminFormField>
    </AdminFormDrawer>
  )
}
