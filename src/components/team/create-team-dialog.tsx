import { zodResolver } from '@hookform/resolvers/zod'
import { generateTeamOrgSlug } from '@shared/org-slugs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, setActive } from '@/lib/auth-client'

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  logo: z.string().url().optional().or(z.literal('')),
})

type CreateTeamValues = z.infer<typeof createTeamSchema>

export function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const form = useForm<CreateTeamValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: '', logo: '' },
  })

  const mutation = useMutation({
    mutationFn: async (values: CreateTeamValues) => {
      const { error, data } = await authClient.organization.create({
        name: values.name,
        slug: generateTeamOrgSlug(),
        logo: values.logo || undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: async (data) => {
      toast.success(t('teams.created'))
      await queryClient.invalidateQueries({ queryKey: ['organizations'] })
      onOpenChange(false)
      form.reset()
      if (data?.id) {
        const { error } = await setActive({ organizationId: data.id })
        if (error) throw error
        navigate({ to: '/files' })
      }
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? String(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">{t('teams.teamName')}</Label>
            <Input id="team-name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-logo">
              {t('teams.logo')} <span className="text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Input id="team-logo" placeholder="https://..." {...form.register('logo')} />
            {form.formState.errors.logo && (
              <p className="text-xs text-destructive">{form.formState.errors.logo.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TeamLimitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0">
        <UpgradeHint feature="teams_unlimited" />
      </DialogContent>
    </Dialog>
  )
}
