import { useState } from 'react'

export type ViewMode = 'list' | 'grid'

const STORAGE_KEY = 'zpan-view-mode'

export function useViewMode() {
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(STORAGE_KEY) as ViewMode) || 'list')

  function set(m: ViewMode) {
    localStorage.setItem(STORAGE_KEY, m)
    setMode(m)
  }

  return [mode, set] as const
}
