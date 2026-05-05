import {
  BRANDING_THEME_PRESETS,
  type BrandingConfig,
  type BrandingField,
  type BrandingThemeMode,
  type BrandingThemePresetId,
  type BrandingThemeValues,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brush, ImageUp, Palette, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ThemeColorInput, ThemePreview } from '@/components/admin/branding-theme-preview'
import { brandingQueryKey } from '@/components/branding/BrandingProvider'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getBranding, resetBrandingField, saveBranding } from '@/lib/api'

interface BrandingFormState {
  logoFile: File | null
  faviconFile: File | null
  previewLogoUrl: string | null
  faviconPreviewUrl: string | null
}

const THEME_PRESET_IDS = Object.keys(BRANDING_THEME_PRESETS) as BrandingThemePresetId[]

const DEFAULT_BRANDING: BrandingConfig = {
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

function useBrandingFormState(initial: BrandingConfig): {
  state: BrandingFormState
  setLogoFile: (f: File | null) => void
  setFaviconFile: (f: File | null) => void
  clearLogoPreview: (url?: string | null) => void
  clearFaviconPreview: (url?: string | null) => void
} {
  const [logoFile, setLogoFileRaw] = useState<File | null>(null)
  const [faviconFile, setFaviconFileRaw] = useState<File | null>(null)
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(initial.logo_url)
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(initial.favicon_url)

  const prevLogoBlob = useRef<string | null>(null)
  const prevFaviconBlob = useRef<string | null>(null)

  function setLogoFile(f: File | null) {
    if (prevLogoBlob.current) URL.revokeObjectURL(prevLogoBlob.current)
    const url = f ? URL.createObjectURL(f) : initial.logo_url
    prevLogoBlob.current = f ? url : null
    setLogoFileRaw(f)
    setPreviewLogoUrl(url)
  }

  function setFaviconFile(f: File | null) {
    if (prevFaviconBlob.current) URL.revokeObjectURL(prevFaviconBlob.current)
    const url = f ? URL.createObjectURL(f) : initial.favicon_url
    prevFaviconBlob.current = f ? url : null
    setFaviconFileRaw(f)
    setFaviconPreviewUrl(url)
  }

  function clearLogoPreview(url: string | null = null) {
    if (prevLogoBlob.current) URL.revokeObjectURL(prevLogoBlob.current)
    prevLogoBlob.current = null
    setLogoFileRaw(null)
    setPreviewLogoUrl(url)
  }

  function clearFaviconPreview(url: string | null = null) {
    if (prevFaviconBlob.current) URL.revokeObjectURL(prevFaviconBlob.current)
    prevFaviconBlob.current = null
    setFaviconFileRaw(null)
    setFaviconPreviewUrl(url)
  }

  useEffect(() => {
    if (!prevLogoBlob.current) setPreviewLogoUrl(initial.logo_url)
    if (!prevFaviconBlob.current) setFaviconPreviewUrl(initial.favicon_url)
  }, [initial.logo_url, initial.favicon_url])

  useEffect(() => {
    return () => {
      if (prevLogoBlob.current) URL.revokeObjectURL(prevLogoBlob.current)
      if (prevFaviconBlob.current) URL.revokeObjectURL(prevFaviconBlob.current)
    }
  }, [])

  return {
    state: { logoFile, faviconFile, previewLogoUrl, faviconPreviewUrl },
    setLogoFile,
    setFaviconFile,
    clearLogoPreview,
    clearFaviconPreview,
  }
}

function FileUploadField({
  id,
  label,
  hint,
  emptyLabel,
  replaceLabel,
  resetLabel,
  disabled = false,
  accept,
  previewUrl,
  onFileChange,
  onReset,
}: {
  id: string
  label: string
  hint: string
  emptyLabel: string
  replaceLabel: string
  resetLabel: string
  disabled?: boolean
  accept: string
  previewUrl: string | null
  onFileChange: (file: File | null) => void
  onReset: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-2xl border border-border/60 bg-background p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/30">
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="h-10 w-10 rounded object-contain" />
          ) : (
            <ImageUp className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <div className={`min-w-0 flex-1 space-y-3 ${disabled ? 'opacity-60' : ''}`}>
          <div className="space-y-1">
            <Label htmlFor={id}>{label}</Label>
            <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {previewUrl ? replaceLabel : emptyLabel}
            </Button>
            {previewUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onReset}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {resetLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function BrandingSection() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const { data: branding, isLoading: brandingLoading } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: getBranding,
    staleTime: 5 * 60 * 1000,
  })

  if (entitlementLoading || brandingLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }

  return <BrandingForm disabled={!hasFeature('white_label')} initial={branding ?? DEFAULT_BRANDING} />
}

function BrandingForm({ initial, disabled }: { initial: BrandingConfig; disabled: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { state, setLogoFile, setFaviconFile, clearLogoPreview, clearFaviconPreview } = useBrandingFormState(initial)
  const [themeMode, setThemeMode] = useState<BrandingThemeMode>(initial.theme.mode)
  const [themePreset, setThemePreset] = useState<BrandingThemePresetId>(initial.theme.preset)
  const [customTheme, setCustomTheme] = useState<BrandingThemeValues>(
    initial.theme.custom ?? BRANDING_THEME_PRESETS[initial.theme.preset],
  )
  const savedCustomTheme = initial.theme.custom
  const savedCustomValues = useMemo(() => {
    const primaryColor = savedCustomTheme?.primary_color
    const primaryForeground = savedCustomTheme?.primary_foreground
    const canvasColor = savedCustomTheme?.canvas_color
    const sidebarAccentColor = savedCustomTheme?.sidebar_accent_color
    const ringColor = savedCustomTheme?.ring_color
    if (!primaryColor || !primaryForeground || !canvasColor || !sidebarAccentColor || !ringColor) {
      return BRANDING_THEME_PRESETS[initial.theme.preset]
    }
    return {
      primary_color: primaryColor,
      primary_foreground: primaryForeground,
      canvas_color: canvasColor,
      sidebar_accent_color: sidebarAccentColor,
      ring_color: ringColor,
    }
  }, [
    initial.theme.preset,
    savedCustomTheme?.primary_color,
    savedCustomTheme?.primary_foreground,
    savedCustomTheme?.canvas_color,
    savedCustomTheme?.sidebar_accent_color,
    savedCustomTheme?.ring_color,
  ])
  const previewTheme = themeMode === 'custom' ? customTheme : BRANDING_THEME_PRESETS[themePreset]

  useEffect(() => {
    setThemeMode(initial.theme.mode)
    setThemePreset(initial.theme.preset)
    setCustomTheme(savedCustomValues)
  }, [initial.theme.mode, initial.theme.preset, savedCustomValues])

  const saveAssetsMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        logo: state.logoFile,
        favicon: state.faviconFile,
      }),
    onSuccess: (saved) => {
      clearLogoPreview(saved.logo_url)
      clearFaviconPreview(saved.favicon_url)
      queryClient.invalidateQueries({ queryKey: brandingQueryKey })
      toast.success(t('admin.settings.branding.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const saveThemeMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        theme_mode: themeMode,
        theme_preset: themePreset,
        theme_custom: customTheme,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandingQueryKey })
      toast.success(t('admin.settings.branding.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const resetMutation = useMutation({
    mutationFn: (field: BrandingField) => resetBrandingField(field),
    onSuccess: (_data, field) => {
      queryClient.invalidateQueries({ queryKey: brandingQueryKey })
      if (field === 'logo') clearLogoPreview()
      if (field === 'favicon') clearFaviconPreview()
      if (field === 'theme') {
        setThemeMode('preset')
        setThemePreset('default')
        setCustomTheme(BRANDING_THEME_PRESETS.default)
      }
      toast.success(t('admin.settings.branding.resetSuccess', { field: t(`admin.settings.branding.fields.${field}`) }))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
              <Palette className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle>{t('admin.settings.branding.assetsTitle')}</CardTitle>
                <ProBadge tooltip={t('admin.settings.proLockedWhiteLabel')} />
              </div>
              <CardDescription>{t('admin.settings.branding.assetsDescription')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!disabled && (
            <>
              <FileUploadField
                id="logo-upload"
                label={t('admin.settings.branding.logo')}
                hint={t('admin.settings.branding.logoHint')}
                emptyLabel={t('admin.settings.branding.upload')}
                replaceLabel={t('admin.settings.branding.replace')}
                resetLabel={t('admin.settings.branding.reset')}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                previewUrl={state.previewLogoUrl}
                onFileChange={setLogoFile}
                onReset={() => resetMutation.mutate('logo')}
              />
              <FileUploadField
                id="favicon-upload"
                label={t('admin.settings.branding.favicon')}
                hint={t('admin.settings.branding.faviconHint')}
                emptyLabel={t('admin.settings.branding.upload')}
                replaceLabel={t('admin.settings.branding.replace')}
                resetLabel={t('admin.settings.branding.reset')}
                accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
                previewUrl={state.faviconPreviewUrl}
                onFileChange={setFaviconFile}
                onReset={() => resetMutation.mutate('favicon')}
              />
            </>
          )}
          {disabled && (
            <div className="space-y-4 rounded-2xl border border-dashed border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
              <FileUploadField
                id="logo-upload-disabled"
                label={t('admin.settings.branding.logo')}
                hint={t('admin.settings.branding.logoHint')}
                emptyLabel={t('admin.settings.branding.upload')}
                replaceLabel={t('admin.settings.branding.replace')}
                resetLabel={t('admin.settings.branding.reset')}
                disabled
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                previewUrl={state.previewLogoUrl}
                onFileChange={() => {}}
                onReset={() => {}}
              />
              <FileUploadField
                id="favicon-upload-disabled"
                label={t('admin.settings.branding.favicon')}
                hint={t('admin.settings.branding.faviconHint')}
                emptyLabel={t('admin.settings.branding.upload')}
                replaceLabel={t('admin.settings.branding.replace')}
                resetLabel={t('admin.settings.branding.reset')}
                disabled
                accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
                previewUrl={state.faviconPreviewUrl}
                onFileChange={() => {}}
                onReset={() => {}}
              />
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button onClick={() => saveAssetsMutation.mutate()} disabled={disabled || saveAssetsMutation.isPending}>
              {saveAssetsMutation.isPending ? t('admin.settings.branding.saving') : t('admin.settings.branding.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="border-border/60">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
              <Brush className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle>{t('admin.settings.branding.themeTitle')}</CardTitle>
                <ProBadge tooltip={t('admin.settings.proLockedWhiteLabel')} />
              </div>
              <CardDescription>{t('admin.settings.branding.themeDescription')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {disabled && <p className="text-sm text-muted-foreground">{t('admin.settings.branding.lockedMessage')}</p>}
          <div className={`grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] ${disabled ? 'opacity-60' : ''}`}>
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="theme-mode">{t('admin.settings.branding.themeMode')}</Label>
                  <Select
                    value={themeMode}
                    disabled={disabled}
                    onValueChange={(value) => setThemeMode(value as BrandingThemeMode)}
                  >
                    <SelectTrigger id="theme-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preset">{t('admin.settings.branding.themeModePreset')}</SelectItem>
                      <SelectItem value="custom">{t('admin.settings.branding.themeModeCustom')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="theme-preset">{t('admin.settings.branding.themePreset')}</Label>
                  <Select
                    value={themePreset}
                    disabled={disabled || themeMode === 'custom'}
                    onValueChange={(value) => setThemePreset(value as BrandingThemePresetId)}
                  >
                    <SelectTrigger id="theme-preset" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THEME_PRESET_IDS.map((preset) => (
                        <SelectItem key={preset} value={preset}>
                          {t(`admin.settings.branding.themePresets.${preset}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ThemeColorInput
                  id="theme-primary"
                  label={t('admin.settings.branding.themePrimary')}
                  value={customTheme.primary_color}
                  disabled={disabled || themeMode !== 'custom'}
                  onChange={(primary_color) => setCustomTheme({ ...customTheme, primary_color })}
                />
                <ThemeColorInput
                  id="theme-primary-foreground"
                  label={t('admin.settings.branding.themePrimaryForeground')}
                  value={customTheme.primary_foreground}
                  disabled={disabled || themeMode !== 'custom'}
                  onChange={(primary_foreground) => setCustomTheme({ ...customTheme, primary_foreground })}
                />
                <ThemeColorInput
                  id="theme-canvas"
                  label={t('admin.settings.branding.themeCanvas')}
                  value={customTheme.canvas_color}
                  disabled={disabled || themeMode !== 'custom'}
                  onChange={(canvas_color) => setCustomTheme({ ...customTheme, canvas_color })}
                />
                <ThemeColorInput
                  id="theme-sidebar-accent"
                  label={t('admin.settings.branding.themeSidebarAccent')}
                  value={customTheme.sidebar_accent_color}
                  disabled={disabled || themeMode !== 'custom'}
                  onChange={(sidebar_accent_color) => setCustomTheme({ ...customTheme, sidebar_accent_color })}
                />
                <ThemeColorInput
                  id="theme-ring"
                  label={t('admin.settings.branding.themeRing')}
                  value={customTheme.ring_color}
                  disabled={disabled || themeMode !== 'custom'}
                  onChange={(ring_color) => setCustomTheme({ ...customTheme, ring_color })}
                />
              </div>
            </div>
            <ThemePreview values={previewTheme} />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || resetMutation.isPending}
              onClick={() => resetMutation.mutate('theme')}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('admin.settings.branding.resetTheme')}
            </Button>
            <Button onClick={() => saveThemeMutation.mutate()} disabled={disabled || saveThemeMutation.isPending}>
              {saveThemeMutation.isPending
                ? t('admin.settings.branding.saving')
                : t('admin.settings.branding.saveTheme')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
