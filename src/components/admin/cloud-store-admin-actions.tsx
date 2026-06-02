import type { GiftCardStatus } from '@shared/schemas'
import type { CloudProduct } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  emptyGiftCardForm,
  giftCardInputFromForm,
  StorageGiftCardPanel,
} from '@/components/admin/cloud-gift-card-panel'
import {
  CreditPackageForm,
  creditPackageFormFromPackage,
  creditPackageInputFromForm,
  emptyCreditPackageForm,
  emptyPackageForm,
  packageFormFromPackage,
  packageInputFromForm,
  StoragePlanForm,
} from '@/components/admin/cloud-product-form'
import { CreditPackageList, StoragePlanList } from '@/components/admin/cloud-product-list'
import {
  createCloudGiftCards,
  createCloudProduct,
  deleteCloudGiftCard,
  deleteCloudProduct,
  disableCloudGiftCard,
  updateCloudProduct,
} from '@/lib/api'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type PackageFilter = 'all' | 'active' | 'disabled'

export function usePackageEditor() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CloudProduct | null>(null)
  const [deleting, setDeleting] = useState<CloudProduct | null>(null)
  const [form, setForm] = useState(emptyPackageForm)
  const mutation = usePackageMutation(editing, form, () => {
    setOpen(false)
    setEditing(null)
    setForm(emptyPackageForm)
  })
  const publishMutation = usePackagePublishMutation()
  const deleteMutation = usePackageDeleteMutation(() => setDeleting(null))
  return {
    open,
    editing,
    deleting,
    form,
    setForm,
    newPackage: () => {
      setEditing(null)
      setForm(emptyPackageForm)
      setOpen(true)
    },
    mutation,
    publishMutation,
    deleteMutation,
    edit: (pkg: CloudProduct) => editPackage(pkg, setEditing, setForm, setOpen),
    publish: (pkg: CloudProduct, active: boolean) => publishMutation.mutate({ id: pkg.id, active }),
    delete: (pkg: CloudProduct) => setDeleting(pkg),
    cancelDelete: () => setDeleting(null),
    confirmDelete: () => {
      if (deleting) deleteMutation.mutate(deleting.id)
    },
    cancel: () => {
      setOpen(false)
      setEditing(null)
      setForm(emptyPackageForm)
    },
  }
}

export function useCreditPackageEditor() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CloudProduct | null>(null)
  const [deleting, setDeleting] = useState<CloudProduct | null>(null)
  const [form, setForm] = useState(emptyCreditPackageForm)
  const mutation = useCreditPackageMutation(editing, form, () => {
    setOpen(false)
    setEditing(null)
    setForm(emptyCreditPackageForm)
  })
  const publishMutation = usePackagePublishMutation()
  const deleteMutation = usePackageDeleteMutation(() => setDeleting(null))
  return {
    open,
    editing,
    deleting,
    form,
    setForm,
    newPackage: () => {
      setEditing(null)
      setForm(emptyCreditPackageForm)
      setOpen(true)
    },
    mutation,
    publishMutation,
    deleteMutation,
    edit: (pkg: CloudProduct) => editCreditPackage(pkg, setEditing, setForm, setOpen),
    publish: (pkg: CloudProduct, active: boolean) => publishMutation.mutate({ id: pkg.id, active }),
    delete: (pkg: CloudProduct) => setDeleting(pkg),
    cancelDelete: () => setDeleting(null),
    confirmDelete: () => {
      if (deleting) deleteMutation.mutate(deleting.id)
    },
    cancel: () => {
      setOpen(false)
      setEditing(null)
      setForm(emptyCreditPackageForm)
    },
  }
}

export function useGiftCardActions() {
  const [form, setForm] = useState(emptyGiftCardForm)
  const [disablingGiftCard, setDisablingGiftCard] = useState<string | null>(null)
  const [deletingGiftCard, setDeletingGiftCard] = useState<string | null>(null)
  const generate = useGenerateGiftCardsMutation(form, () => setForm(emptyGiftCardForm))
  const disable = useDisableGiftCardMutation(setDisablingGiftCard)
  const deleteGiftCard = useDeleteGiftCardMutation(setDeletingGiftCard)
  return { form, setForm, disablingGiftCard, deletingGiftCard, generate, disable, deleteGiftCard }
}

export function PackagesTab({
  available,
  packages,
  creditPackages,
  editor,
  creditEditor,
}: {
  available: boolean
  packages: CloudProduct[]
  creditPackages: CloudProduct[]
  editor: ReturnType<typeof usePackageEditor>
  creditEditor: ReturnType<typeof useCreditPackageEditor>
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<PackageFilter>('all')
  const visiblePackages = filterPackages(packages, filter)
  const visibleCreditPackages = filterPackages(creditPackages, filter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Select value={filter} onValueChange={(value) => setFilter(value as PackageFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.cloudStore.packages.filterAll')}</SelectItem>
            <SelectItem value="active">{t('admin.cloudStore.packages.filterActive')}</SelectItem>
            <SelectItem value="disabled">{t('admin.cloudStore.packages.filterDisabled')}</SelectItem>
          </SelectContent>
        </Select>
        <Button disabled={!available} onClick={editor.newPackage}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.cloudStore.newPackage')}
        </Button>
      </div>
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">{t('admin.cloudStore.planProductsTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('admin.cloudStore.planProductsDescription')}</p>
        </div>
        <StoragePlanList
          packages={visiblePackages}
          actionPending={editor.publishMutation.isPending || editor.deleteMutation.isPending}
          onEdit={editor.edit}
          onDelete={editor.delete}
          onPublishChange={editor.publish}
        />
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{t('admin.cloudStore.creditProductsTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('admin.cloudStore.creditProductsDescription')}</p>
          </div>
          <Button disabled={!available} onClick={creditEditor.newPackage}>
            <Plus className="mr-2 h-4 w-4" />
            {t('admin.cloudStore.newCreditPackage')}
          </Button>
        </div>
        <CreditPackageList
          packages={visibleCreditPackages}
          actionPending={creditEditor.publishMutation.isPending || creditEditor.deleteMutation.isPending}
          onEdit={creditEditor.edit}
          onDelete={creditEditor.delete}
          onPublishChange={creditEditor.publish}
        />
      </section>
      <PackageDialog available={available} editor={editor} />
      <DeletePackageDialog editor={editor} />
      <CreditPackageDialog available={available} editor={creditEditor} />
      <DeleteCreditPackageDialog editor={creditEditor} />
    </div>
  )
}

function PackageDialog({ available, editor }: { available: boolean; editor: ReturnType<typeof usePackageEditor> }) {
  const { t } = useTranslation()
  return (
    <Dialog open={editor.open} onOpenChange={(open) => (open ? editor.newPackage() : editor.cancel())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editor.editing ? t('admin.cloudStore.editPackage') : t('admin.cloudStore.newPackage')}
          </DialogTitle>
        </DialogHeader>
        <StoragePlanForm
          editing={editor.editing}
          form={editor.form}
          available={available}
          pending={editor.mutation.isPending}
          onFormChange={editor.setForm}
          onCancel={editor.cancel}
          onSubmit={() => editor.mutation.mutate()}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreditPackageDialog({
  available,
  editor,
}: {
  available: boolean
  editor: ReturnType<typeof useCreditPackageEditor>
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={editor.open} onOpenChange={(open) => (open ? editor.newPackage() : editor.cancel())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editor.editing ? t('admin.cloudStore.editCreditPackage') : t('admin.cloudStore.newCreditPackage')}
          </DialogTitle>
        </DialogHeader>
        <CreditPackageForm
          editing={editor.editing}
          form={editor.form}
          available={available}
          pending={editor.mutation.isPending}
          onFormChange={editor.setForm}
          onCancel={editor.cancel}
          onSubmit={() => editor.mutation.mutate()}
        />
      </DialogContent>
    </Dialog>
  )
}

function DeletePackageDialog({ editor }: { editor: ReturnType<typeof usePackageEditor> }) {
  const { t } = useTranslation()
  const pkg = editor.deleting
  if (!pkg) return null

  return (
    <Dialog
      open={Boolean(pkg)}
      onOpenChange={(open) => {
        if (!open && !editor.deleteMutation.isPending) editor.cancelDelete()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.cloudStore.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('admin.cloudStore.deleteConfirm', { name: pkg.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={editor.cancelDelete} disabled={editor.deleteMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={editor.deleteMutation.isPending} onClick={editor.confirmDelete}>
            {editor.deleteMutation.isPending ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteCreditPackageDialog({ editor }: { editor: ReturnType<typeof useCreditPackageEditor> }) {
  const { t } = useTranslation()
  const pkg = editor.deleting
  if (!pkg) return null

  return (
    <Dialog
      open={Boolean(pkg)}
      onOpenChange={(open) => {
        if (!open && !editor.deleteMutation.isPending) editor.cancelDelete()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.cloudStore.deleteCreditTitle')}</DialogTitle>
          <DialogDescription>{t('admin.cloudStore.deleteConfirm', { name: pkg.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={editor.cancelDelete} disabled={editor.deleteMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={editor.deleteMutation.isPending} onClick={editor.confirmDelete}>
            {editor.deleteMutation.isPending ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GiftCardsTab({
  actions,
  available,
  codes,
  status,
  onStatusChange,
}: {
  actions: ReturnType<typeof useGiftCardActions>
  available: boolean
  codes: Parameters<typeof StorageGiftCardPanel>[0]['codes']
  status: GiftCardStatus | 'all'
  onStatusChange: (status: GiftCardStatus | 'all') => void
}) {
  return (
    <StorageGiftCardPanel
      codes={codes}
      status={status}
      form={actions.form}
      available={available}
      pending={actions.generate.isPending}
      disablingGiftCard={actions.disablingGiftCard}
      deletingGiftCard={actions.deletingGiftCard}
      onStatusChange={onStatusChange}
      onFormChange={actions.setForm}
      onGenerate={() => actions.generate.mutate()}
      onRevoke={(code) => actions.disable.mutate(code)}
      onDelete={(code) => actions.deleteGiftCard.mutate(code)}
    />
  )
}

function usePackageMutation(editing: CloudProduct | null, form: typeof emptyPackageForm, onSaved: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => savePackage(editing, form),
    onSuccess: () => {
      onSaved()
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store'] })
      toast.success(t('admin.cloudStore.packageSaved'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useCreditPackageMutation(
  editing: CloudProduct | null,
  form: typeof emptyCreditPackageForm,
  onSaved: () => void,
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => saveCreditPackage(editing, form),
    onSuccess: () => {
      onSaved()
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store'] })
      toast.success(t('admin.cloudStore.packageSaved'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function usePackagePublishMutation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateCloudProduct(id, { active }),
    onSuccess: (_pkg, input) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store'] })
      toast.success(t(input.active ? 'admin.cloudStore.packagePublished' : 'admin.cloudStore.packageUnpublished'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function usePackageDeleteMutation(onDeleted: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCloudProduct,
    onSuccess: () => {
      onDeleted()
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store'] })
      toast.success(t('admin.cloudStore.packageDeleted'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useGenerateGiftCardsMutation(form: typeof emptyGiftCardForm, onGenerated: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => createCloudGiftCards(giftCardInputFromForm(form)),
    onSuccess: () => {
      onGenerated()
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store', 'gift-cards'] })
      toast.success(t('admin.cloudStore.codes.generated'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useDisableGiftCardMutation(setDisablingGiftCard: (code: string | null) => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: disableCloudGiftCard,
    onMutate: (code) => setDisablingGiftCard(code),
    onSettled: () => setDisablingGiftCard(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store', 'gift-cards'] })
      toast.success(t('admin.cloudStore.codes.disabled'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useDeleteGiftCardMutation(setDeletingGiftCard: (code: string | null) => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCloudGiftCard,
    onMutate: (code) => setDeletingGiftCard(code),
    onSettled: () => setDeletingGiftCard(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store', 'gift-cards'] })
      toast.success(t('admin.cloudStore.codes.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function editPackage(
  pkg: CloudProduct,
  setEditing: (pkg: CloudProduct) => void,
  setForm: (form: typeof emptyPackageForm) => void,
  setOpen: (open: boolean) => void,
) {
  setEditing(pkg)
  setForm(packageFormFromPackage(pkg))
  setOpen(true)
}

function editCreditPackage(
  pkg: CloudProduct,
  setEditing: (pkg: CloudProduct) => void,
  setForm: (form: typeof emptyCreditPackageForm) => void,
  setOpen: (open: boolean) => void,
) {
  setEditing(pkg)
  setForm(creditPackageFormFromPackage(pkg))
  setOpen(true)
}

function savePackage(editing: CloudProduct | null, form: typeof emptyPackageForm) {
  const input = packageInputFromForm(form)
  if (!editing) return createCloudProduct(input)
  return updateCloudProduct(editing.id, {
    type: input.type,
    name: input.name,
    description: input.description,
    metadata: input.metadata,
    prices: input.prices,
    sortOrder: input.sortOrder,
  })
}

function saveCreditPackage(editing: CloudProduct | null, form: typeof emptyCreditPackageForm) {
  const input = creditPackageInputFromForm(form)
  if (!editing) return createCloudProduct(input)
  return updateCloudProduct(editing.id, {
    type: input.type,
    name: input.name,
    description: input.description,
    metadata: input.metadata,
    prices: input.prices,
    sortOrder: input.sortOrder,
  })
}

function filterPackages(packages: CloudProduct[], filter: PackageFilter) {
  if (filter === 'active') return packages.filter((pkg) => pkg.active)
  if (filter === 'disabled') return packages.filter((pkg) => !pkg.active)
  return packages
}
