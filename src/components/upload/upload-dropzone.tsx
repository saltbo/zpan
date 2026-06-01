import { DirType } from '@shared/constants'
import { Upload } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import type { Prompt } from '@/components/files/hooks/use-conflict-resolver'
import { withConflictRetry } from '@/components/files/hooks/use-conflict-resolver'
import { cancelUpload, confirmUpload, createObject, isNameConflictError, uploadToS3 } from '../../lib/api'
import { type UploadRunnerContext, useUploadQueue } from './upload-queue'

type DirectoryFile = File & {
  webkitRelativePath?: string
}

interface UploadDropzoneProps {
  parent: string
  onUploadComplete: () => void
  /** When provided, name conflicts during upload open a resolver dialog. */
  conflictPrompt?: Prompt
  /** Reset the resolver's "apply to all" before a new batch of drops. */
  onConflictBatchStart?: () => void
  /**
   * Custom upload function. When provided, bypasses the default object-upload
   * flow (create-draft → S3 PUT → confirm) and calls this instead.
   * Used by Image Host to upload via /api/ihost/images.
   */
  uploadFn?: (file: File, ctx: UploadRunnerContext) => Promise<void>
  children: React.ReactNode
}

export interface UploadDropzoneHandle {
  openFileDialog: () => void
  openDirectoryDialog: () => void
}

function joinPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name
}

export function relativePathParts(file: File): string[] {
  const path = (file as DirectoryFile).webkitRelativePath || file.name
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function isDirectorySelection(files: File[]) {
  return files.some((file) => relativePathParts(file).length > 1)
}

async function createFolder(
  name: string,
  parent: string,
  prompt: Prompt | undefined,
  showApplyToAll: boolean,
): Promise<string | 'cancelled'> {
  const created = prompt
    ? await withConflictRetry(
        prompt,
        'folder',
        (strategy) =>
          createObject({
            name,
            type: 'folder',
            parent,
            dirtype: DirType.USER_FOLDER,
            onConflict: strategy,
          }),
        { showApplyToAll },
      )
    : await createObject({
        name,
        type: 'folder',
        parent,
        dirtype: DirType.USER_FOLDER,
      })
  if (!created) return 'cancelled'
  return created.name
}

async function ensureDirectoryPath(
  baseParent: string,
  parts: string[],
  folders: Map<string, Promise<string>>,
  prompt: Prompt | undefined,
  showApplyToAll: boolean,
): Promise<string | 'cancelled'> {
  let intendedParent = baseParent
  let actualParent = baseParent

  for (const part of parts) {
    const intendedPath = joinPath(intendedParent, part)
    const existing = folders.get(intendedPath)
    if (existing) {
      actualParent = await existing
      intendedParent = intendedPath
      continue
    }

    const folderParent = actualParent
    const created = createFolder(part, folderParent, prompt, showApplyToAll).then((name) => {
      if (name === 'cancelled') throw new DOMException('Upload cancelled', 'AbortError')
      return joinPath(folderParent, name)
    })
    folders.set(intendedPath, created)
    actualParent = await created
    intendedParent = intendedPath
  }

  return actualParent
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
  ctx: UploadRunnerContext,
): Promise<boolean | 'cancelled'> {
  ctx.setStatus('preparing')
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
  ctx.registerCleanup(async () => {
    await cancelUpload(created.id)
  })
  if (ctx.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')

  ctx.setStatus('uploading')
  await uploadToS3(created.uploadUrl, file, {
    onProgress: ctx.onProgress,
    signal: ctx.signal,
    contentDisposition: created.contentDisposition,
  })
  if (ctx.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')

  // Step 2: confirm. Another client may have activated the same name during our
  // S3 PUT — repeat the resolver here so replace/rename still works.
  ctx.setStatus('confirming')
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

async function uploadDirectoryFile(
  file: File,
  baseParent: string,
  folders: Map<string, Promise<string>>,
  prompt: Prompt | undefined,
  showApplyToAll: boolean,
  ctx: UploadRunnerContext,
): Promise<boolean | 'cancelled'> {
  const parts = relativePathParts(file)
  const folderParts = parts.slice(0, -1)
  const parent = await ensureDirectoryPath(baseParent, folderParts, folders, prompt, showApplyToAll)
  if (parent === 'cancelled') return 'cancelled'
  return uploadFile(file, parent, prompt, showApplyToAll, ctx)
}

function makeQueuedPrompt(prompt: Prompt): Prompt {
  let tail = Promise.resolve()
  return (args) => {
    const run = tail.then(() => prompt(args))
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export const UploadDropzone = forwardRef<UploadDropzoneHandle, UploadDropzoneProps>(
  ({ parent, onUploadComplete, conflictPrompt, onConflictBatchStart, uploadFn, children }, ref) => {
    const { t } = useTranslation()
    const uploadQueue = useUploadQueue()

    const onDrop = useCallback(
      async (files: File[]) => {
        if (files.length === 0) return

        // Custom upload path (e.g. image host)
        if (uploadFn) {
          uploadQueue.enqueue(
            files.map((file) => ({
              file,
              run: (ctx) => uploadFn(file, ctx),
            })),
            (hadSuccess) => {
              if (hadSuccess) onUploadComplete()
            },
          )
          return
        }

        // Default object-upload path
        onConflictBatchStart?.()
        const directorySelection = isDirectorySelection(files)
        const showApplyToAll = files.length > 1
        const queuedPrompt = conflictPrompt ? makeQueuedPrompt(conflictPrompt) : undefined
        const folders = new Map<string, Promise<string>>()

        uploadQueue.enqueue(
          files.map((file) => ({
            file,
            run: async (ctx) => {
              const result = directorySelection
                ? await uploadDirectoryFile(file, parent, folders, queuedPrompt, showApplyToAll, ctx)
                : await uploadFile(file, parent, queuedPrompt, showApplyToAll, ctx)
              if (result === 'cancelled') throw new DOMException('Upload cancelled', 'AbortError')
            },
          })),
          (hadSuccess) => {
            if (hadSuccess) onUploadComplete()
          },
        )
      },
      [parent, uploadFn, onUploadComplete, conflictPrompt, onConflictBatchStart, uploadQueue],
    )

    const openDirectoryDialog = useCallback(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
      input.addEventListener('change', () => {
        void onDrop(Array.from(input.files ?? []))
      })
      input.click()
    }, [onDrop])

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
      onDrop,
      multiple: true,
      noClick: true,
      noKeyboard: true,
    })

    useImperativeHandle(ref, () => ({ openFileDialog: open, openDirectoryDialog }), [open, openDirectoryDialog])

    return (
      <div {...getRootProps()} className="relative h-full">
        <input {...getInputProps({ className: 'hidden' })} />
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
