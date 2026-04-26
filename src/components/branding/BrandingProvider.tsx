import type { BrandingConfig } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import { getBranding } from '@/lib/api'

export const brandingQueryKey = ['branding'] as const

interface BrandingContext {
  branding: BrandingConfig
  isLoading: boolean
}

const defaultBranding: BrandingConfig = {
  logo_url: null,
  favicon_url: null,
  wordmark_text: null,
  hide_powered_by: false,
}

const BrandingCtx = createContext<BrandingContext>({
  branding: defaultBranding,
  isLoading: false,
})

export function useBranding() {
  return useContext(BrandingCtx)
}

function applyFavicon(url: string | null) {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = url ?? '/favicon.ico'
}

function BrandingEffects({ branding }: { branding: BrandingConfig }) {
  useEffect(() => {
    applyFavicon(branding.favicon_url)
  }, [branding.favicon_url])

  return null
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: getBranding,
    staleTime: 5 * 60 * 1000,
  })

  const branding = data ?? defaultBranding

  return (
    <BrandingCtx.Provider value={{ branding, isLoading }}>
      <BrandingEffects branding={branding} />
      {children}
    </BrandingCtx.Provider>
  )
}
