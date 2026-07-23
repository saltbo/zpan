import { useState } from 'react'

export type ViewMode = 'list' | 'grid' | 'posters'

const DEFAULT_STORAGE_KEY = 'zpan-view-mode'

export function useViewMode(storageKey = DEFAULT_STORAGE_KEY, defaultMode: ViewMode = 'list') {
  const [mode, setMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(storageKey)
    return saved === 'list' || saved === 'grid' || saved === 'posters' ? saved : defaultMode
  })

  function set(m: ViewMode) {
    localStorage.setItem(storageKey, m)
    setMode(m)
  }

  return [mode, set] as const
}
