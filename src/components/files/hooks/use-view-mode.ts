import { useState } from 'react'

export type ViewMode = 'list' | 'grid'

const DEFAULT_STORAGE_KEY = 'zpan-view-mode'

export function useViewMode(storageKey = DEFAULT_STORAGE_KEY) {
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(storageKey) as ViewMode) || 'list')

  function set(m: ViewMode) {
    localStorage.setItem(storageKey, m)
    setMode(m)
  }

  return [mode, set] as const
}
