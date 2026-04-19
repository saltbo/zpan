import { DirType } from '@shared/constants'
import { Upload } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Prompt } from '@/components/files/hooks/use-conflict-resolver'
import { withConflictRetry } from '@/components/files/hooks/use-conflict-resolver'
import { confirmUpload, createObject, isNameConflictError, uploadToS3 } from '../../lib/api'

interface UploadDropzoneProps {
  parent: string
  onUploadComplete: () => void
  /** When provided, name conflicts during upload open a resolver dialog. */
  conflictPrompt?: Prompt
  /** Reset the resolver's "apply to all" before a new batch of drops. */
  onConflictBatchStart?: () => void
  children: React.ReactNode
}

export interface UploadDropzoneHandle {
  openFileDialog: () => void
}

/**
 * Uploads a file end-to-end: create draft → presigned PUT → confirm.
 * Returns true on success, or 'cancelled' when the user dismissed a conflict dialog.
 * Conflicts can fire at either step: pre-upload (create) or post-upload (confirm).
 */
async function uploadFile(
  file: File,
  parent: string,
  prompt: Prompt | undefined,
  showApplyToAll: boolean,
): Promise<boolean | 'cancelled'> {
  // Step 1: create draft (resolves conflict against existing actives BEFORE the S3 PUT).
  const created = prompt
    ? await withConflictRetry(
        prompt,
        'file',
        (strategy) =>
          createObject({
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            parent,
            dirtype: DirType.FILE,
            onConflict: strategy,
          }),
        { showApplyToAll },
      )
    : await createObject({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        parent,
        dirtype: DirType.FILE,
      })
  if (!created) return 'cancelled'
  if (!created.uploadUrl) throw new Error('No upload URL returned')

  await uploadToS3(created.uploadUrl, file)

  // Step 2: confirm. Another client may have activated the same name during our
  // S3 PUT — repeat the resolver here so replace/rename still works.
  try {
    await confirmUpload(created.id)
  } catch (e) {
    if (!prompt || !isNameConflictError(e)) throw e
    const res = await prompt({ kind: 'file', name: e.body.conflictingName, showApplyToAll })
    if ('cancelled' in res) return 'cancelled'
    await confirmUpload(created.id, res.strategy)
  }
  return true
}

export const UploadDropzone = forwardRef<UploadDropzoneHandle, UploadDropzoneProps>(
  ({ parent, onUploadComplete, conflictPrompt, onConflictBatchStart, children }, ref) => {
    const { t } = useTranslation()

    const onDrop = useCallback(
      async (files: File[]) => {
        onConflictBatchStart?.()
        const showApplyToAll = files.length > 1
        let anySuccess = false
        let processed = 0

        // Process sequentially so the resolver's "apply to all" sticks across files.
        for (const file of files) {
          const p = uploadFile(file, parent, conflictPrompt, showApplyToAll)
          toast.promise(
            p.then((result) => {
              if (result === 'cancelled') throw new Error('cancelled')
              return result
            }),
            {
              loading: t('files.uploading', { name: file.name }),
              success: t('files.uploadSuccess', { name: file.name }),
              error: (err: Error) =>
                err.message === 'cancelled' ? null : t('files.uploadFailed', { name: file.name }),
            },
          )
          try {
            const result = await p
            processed++
            if (result === true) anySuccess = true
            if (result === 'cancelled') {
              // Finder-style: cancelling a conflict aborts the rest of the batch.
              // Tell the user what just happened so remaining files aren't a mystery.
              const remaining = files.length - processed
              if (remaining > 0) toast.info(t('files.uploadBatchCancelled', { count: remaining }))
              break
            }
          } catch {
            processed++
            // Toast already surfaced the error — continue with next file.
          }
        }

        if (anySuccess) onUploadComplete()
      },
      [parent, onUploadComplete, conflictPrompt, onConflictBatchStart, t],
    )

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
      onDrop,
      noClick: true,
      noKeyboard: true,
    })

    useImperativeHandle(ref, () => ({ openFileDialog: open }), [open])

    return (
      <div {...getRootProps()} className="relative h-full">
        <input {...getInputProps()} />
        {children}
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
            <Upload className="h-12 w-12 text-primary" />
            <p className="text-lg font-medium text-primary">{t('files.dropToUpload')}</p>
          </div>
        )}
      </div>
    )
  },
)
