import {
  BRANDING_THEME_PRESETS,
  type BrandingConfig,
  type BrandingThemeConfig,
  type BrandingThemeValues,
} from '@shared/types'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { siteConfigQueryKey, useSiteConfig } from '@/hooks/use-site-config'

export const brandingQueryKey = siteConfigQueryKey

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
  if (url) link.removeAttribute('type')
  else link.type = 'image/png'
  link.href = url ?? '/favicon.png'
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
  const { data, isLoading } = useSiteConfig()
  const branding: BrandingConfig = data
    ? {
        logo_url: data.branding.logoUrl,
        favicon_url: data.branding.faviconUrl,
        wordmark_text: data.branding.wordmark,
        hide_powered_by: data.branding.hidePoweredBy,
        theme: {
          mode: data.branding.theme.mode,
          preset: data.branding.theme.preset,
          custom: data.branding.theme.custom
            ? {
                primary_color: data.branding.theme.custom.primaryColor,
                primary_foreground: data.branding.theme.custom.primaryForeground,
                canvas_color: data.branding.theme.custom.canvasColor,
                sidebar_accent_color: data.branding.theme.custom.sidebarAccentColor,
                ring_color: data.branding.theme.custom.ringColor,
              }
            : null,
          configured: data.branding.theme.configured,
        },
      }
    : defaultBranding

  return (
    <BrandingCtx.Provider value={{ branding, isLoading }}>
      <BrandingEffects branding={branding} />
      {children}
    </BrandingCtx.Provider>
  )
}
