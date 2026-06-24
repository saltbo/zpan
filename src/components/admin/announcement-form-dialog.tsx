import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminFormDrawer, AdminFormField, AdminSwitchField } from '@/components/admin/admin-form-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Announcement, AnnouncementInput } from '@/lib/api'

const AnnouncementMarkdownEditor = lazy(() =>
  import('./announcement-markdown-editor').then((module) => ({
    default: module.AnnouncementMarkdownEditor,
  })),
)

interface AnnouncementFormDialogProps {
  open: boolean
  announcement: Announcement | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AnnouncementInput) => void
}

export function AnnouncementFormDialog({
  open,
  announcement,
  saving,
  onOpenChange,
  onSubmit,
}: AnnouncementFormDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    setTitle(announcement?.title ?? '')
    setBody(announcement?.body ?? '')
    setPinned((announcement?.priority ?? 0) > 0)
  }, [announcement])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    onSubmit({
      title,
      body,
      status: announcement?.status ?? 'draft',
      priority: pinned ? 100 : 0,
    })
  }

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      width="extra-wide"
      title={announcement ? t('admin.announcement.editTitle') : t('admin.announcement.createTitle')}
      description={t('admin.announcement.description')}
      bodyClassName="grid gap-5"
      formProps={{ onSubmit: handleSubmit }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <AdminFormField id="announcement-title" label={t('admin.announcement.fieldTitle')}>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
      </AdminFormField>

      <AdminSwitchField
        id="announcement-pinned"
        label={t('admin.announcement.fieldPinned')}
        checked={pinned}
        onCheckedChange={setPinned}
      />

      <AdminFormField id="announcement-body" label={t('admin.announcement.fieldBody')}>
        <div>
          <Suspense fallback={<div className="h-[360px] rounded-md border bg-muted/20" />}>
            <AnnouncementMarkdownEditor
              id="announcement-body"
              label={t('admin.announcement.fieldBody')}
              value={body}
              onChange={setBody}
            />
          </Suspense>
        </div>
      </AdminFormField>
    </AdminFormDrawer>
  )
}
