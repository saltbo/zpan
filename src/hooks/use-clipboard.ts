import i18next from 'i18next'
import { toast } from 'sonner'

export function useClipboard() {
  async function copy(text: string, successKey = 'common.copied') {
    await navigator.clipboard.writeText(text)
    toast.success(i18next.t(successKey))
  }

  return { copy }
}
