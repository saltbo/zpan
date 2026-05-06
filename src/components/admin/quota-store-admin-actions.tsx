import type { StorageCodeStatus } from '@shared/schemas'
import type { QuotaStorePackage } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { codeInputFromForm, emptyCodeForm, QuotaStoreCodePanel } from '@/components/admin/quota-store-code-panel'
import {
  emptyPackageForm,
  packageFormFromPackage,
  packageInputFromForm,
  QuotaStorePackageForm,
} from '@/components/admin/quota-store-package-form'
import { QuotaStorePackageList } from '@/components/admin/quota-store-package-list'
import { type emptySettingsForm, settingsInput } from '@/components/admin/quota-store-settings-panel'
import {
  createQuotaStorePackage,
  generateStorageRedemptionCodes,
  revokeStorageRedemptionCode,
  syncQuotaStorePackages,
  updateQuotaStorePackage,
  updateQuotaStoreSettings,
} from '@/lib/api'

export function useSettingsActions() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (form: typeof emptySettingsForm) => updateQuotaStoreSettings(settingsInput(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store'] })
      toast.success(t('admin.quotaStore.saved'))
    },
    onError: (err) => toast.error(err.message),
  })
  return { isPending: mutation.isPending, save: mutation.mutate }
}

export function useSyncMutation() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: syncQuotaStorePackages,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store'] })
      toast.success(t('admin.quotaStore.synced'))
    },
    onError: (err) => toast.error(err.message),
  })
}

export function usePackageEditor() {
  const [editing, setEditing] = useState<QuotaStorePackage | null>(null)
  const [form, setForm] = useState(emptyPackageForm)
  const mutation = usePackageMutation(editing, form, () => {
    setEditing(null)
    setForm(emptyPackageForm)
  })
  return {
    editing,
    form,
    setForm,
    mutation,
    edit: (pkg: QuotaStorePackage) => editPackage(pkg, setEditing, setForm),
    cancel: () => {
      setEditing(null)
      setForm(emptyPackageForm)
    },
  }
}

export function useCodeActions() {
  const [form, setForm] = useState(emptyCodeForm)
  const [revokingCode, setRevokingCode] = useState<string | null>(null)
  const generate = useGenerateCodesMutation(form, () => setForm(emptyCodeForm))
  const revoke = useRevokeCodeMutation(setRevokingCode)
  return { form, setForm, revokingCode, generate, revoke }
}

export function PackagesTab({
  available,
  packages,
  editor,
}: {
  available: boolean
  packages: QuotaStorePackage[]
  editor: ReturnType<typeof usePackageEditor>
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <QuotaStorePackageForm
        editing={editor.editing}
        form={editor.form}
        available={available}
        pending={editor.mutation.isPending}
        onFormChange={editor.setForm}
        onCancel={editor.cancel}
        onSubmit={() => editor.mutation.mutate()}
      />
      <QuotaStorePackageList packages={packages} onEdit={editor.edit} />
    </div>
  )
}

export function CodesTab({
  actions,
  available,
  codes,
  status,
  onStatusChange,
}: {
  actions: ReturnType<typeof useCodeActions>
  available: boolean
  codes: Parameters<typeof QuotaStoreCodePanel>[0]['codes']
  status: StorageCodeStatus | 'all'
  onStatusChange: (status: StorageCodeStatus | 'all') => void
}) {
  return (
    <QuotaStoreCodePanel
      codes={codes}
      status={status}
      form={actions.form}
      available={available}
      pending={actions.generate.isPending}
      revokingCode={actions.revokingCode}
      onStatusChange={onStatusChange}
      onFormChange={actions.setForm}
      onGenerate={() => actions.generate.mutate()}
      onRevoke={(code) => actions.revoke.mutate(code)}
    />
  )
}

function usePackageMutation(editing: QuotaStorePackage | null, form: typeof emptyPackageForm, onSaved: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => savePackage(editing, form),
    onSuccess: () => {
      onSaved()
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store'] })
      toast.success(t('admin.quotaStore.packageSaved'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useGenerateCodesMutation(form: typeof emptyCodeForm, onGenerated: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => generateStorageRedemptionCodes(codeInputFromForm(form)),
    onSuccess: () => {
      onGenerated()
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store', 'storage-codes'] })
      toast.success(t('admin.quotaStore.codes.generated'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function useRevokeCodeMutation(setRevokingCode: (code: string | null) => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokeStorageRedemptionCode,
    onMutate: (code) => setRevokingCode(code),
    onSettled: () => setRevokingCode(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'quota-store', 'storage-codes'] })
      toast.success(t('admin.quotaStore.codes.revoked'))
    },
    onError: (err) => toast.error(err.message),
  })
}

function editPackage(
  pkg: QuotaStorePackage,
  setEditing: (pkg: QuotaStorePackage) => void,
  setForm: (form: typeof emptyPackageForm) => void,
) {
  setEditing(pkg)
  setForm(packageFormFromPackage(pkg))
}

function savePackage(editing: QuotaStorePackage | null, form: typeof emptyPackageForm) {
  const input = packageInputFromForm(form)
  return editing ? updateQuotaStorePackage(editing.id, input) : createQuotaStorePackage(input)
}
