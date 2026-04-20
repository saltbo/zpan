import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

export interface ShareLayoutState {
  title: string
  subtitle: string
  meta: string[]
}

interface ShareLayoutContextValue {
  layout: ShareLayoutState
  setLayout: Dispatch<SetStateAction<ShareLayoutState>>
}

export const DEFAULT_SHARE_LAYOUT: ShareLayoutState = {
  title: 'ZPan',
  subtitle: '',
  meta: [],
}

const ShareLayoutContext = createContext<ShareLayoutContextValue | null>(null)

export function ShareLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<ShareLayoutState>(DEFAULT_SHARE_LAYOUT)
  const value = useMemo(() => ({ layout, setLayout }), [layout])
  return <ShareLayoutContext.Provider value={value}>{children}</ShareLayoutContext.Provider>
}

export function useShareLayoutState() {
  const ctx = useContext(ShareLayoutContext)
  if (!ctx) throw new Error('useShareLayoutState must be used within ShareLayoutProvider')
  return ctx
}
