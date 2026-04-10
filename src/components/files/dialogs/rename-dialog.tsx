import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface RenameDialogProps {
  open: boolean
  currentName: string
  onOpenChange: (open: boolean) => void
  onConfirm: (newName: string) => void
  isPending: boolean
}

export function RenameDialog({ open, currentName, onOpenChange, onConfirm, isPending }: RenameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(currentName)
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input) return
        const dot = currentName.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : currentName.length)
        input.focus()
      })
    }
  }, [open, currentName])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed && trimmed !== currentName) {
      onConfirm(trimmed)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('files.rename')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || name.trim() === currentName}>
              {isPending ? t('common.loading') : t('files.rename')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
