import {
  BRANDING_THEME_PRESETS,
  type BrandingConfig,
  type BrandingThemeConfig,
  type BrandingThemeValues,
} from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
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
  theme: {
    mode: 'preset',
    preset: 'default',
    custom: null,
    configured: false,
  },
}

const THEME_VARIABLES = [
  '--zpan-theme-primary',
  '--zpan-theme-primary-foreground',
  '--zpan-theme-ring',
  '--zpan-theme-sidebar-accent',
  '--zpan-theme-canvas',
] as const

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

function themedDarkValue(value: string) {
  return `color-mix(in oklab, ${value} 24%, black)`
}

function themedDarkAccent(value: string) {
  return `color-mix(in oklab, ${value} 36%, black)`
}

function applyTheme(values: BrandingThemeValues | null, dark: boolean) {
  const root = document.documentElement
  for (const variable of THEME_VARIABLES) root.style.removeProperty(variable)
  if (!values) return

  root.style.setProperty('--zpan-theme-primary', values.primary_color)
  root.style.setProperty('--zpan-theme-primary-foreground', values.primary_foreground)
  root.style.setProperty('--zpan-theme-ring', values.ring_color)
  root.style.setProperty(
    '--zpan-theme-sidebar-accent',
    dark ? themedDarkAccent(values.sidebar_accent_color) : values.sidebar_accent_color,
  )
  root.style.setProperty('--zpan-theme-canvas', dark ? themedDarkValue(values.canvas_color) : values.canvas_color)
}

function effectiveThemeValues(theme: BrandingThemeConfig) {
  if (!theme.configured) return null
  if (theme.mode === 'custom') return theme.custom
  return BRANDING_THEME_PRESETS[theme.preset]
}

function BrandingEffects({ branding }: { branding: BrandingConfig }) {
  const theme = branding.theme
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    applyFavicon(branding.favicon_url)
  }, [branding.favicon_url])

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    applyTheme(effectiveThemeValues(theme), dark)
    return () => applyTheme(null, false)
  }, [theme, dark])

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
