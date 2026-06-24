import {
  BRANDING_THEME_PRESETS,
  type BrandingConfig,
  type BrandingField,
  type BrandingThemeMode,
  type BrandingThemePresetId,
  type BrandingThemeValues,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, ImageUp, Palette, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { ThemeColorInput, ThemePreview } from '@/components/admin/branding-theme-preview'
import { brandingQueryKey } from '@/components/branding/BrandingProvider'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getBranding, resetBrandingField, saveBranding } from '@/lib/api'
import { cn } from '@/lib/utils'

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
  const uploadLabel = previewUrl ? replaceLabel : emptyLabel

  return (
    <div className="flex flex-col gap-1">
      <AdminFormLabel htmlFor={id} help={hint}>
        {label}
      </AdminFormLabel>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 shadow-xs transition-colors hover:bg-accent/40',
          disabled && 'opacity-60 hover:bg-background',
        )}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={uploadLabel}
          title={uploadLabel}
          onClick={() => inputRef.current?.click()}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted transition-colors hover:bg-background disabled:pointer-events-none"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="size-5 rounded-sm object-contain" />
          ) : (
            <ImageUp className="size-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground disabled:pointer-events-none"
        >
          {hint}
        </button>
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={uploadLabel}
            title={uploadLabel}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || !previewUrl}
            aria-label={resetLabel}
            title={resetLabel}
            onClick={onReset}
            className="text-muted-foreground hover:text-destructive"
          >
            <RotateCcw className="size-3.5" />
          </Button>
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
  const [drawerOpen, setDrawerOpen] = useState(false)
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
  const themeSourceValue = themeMode === 'custom' ? 'custom' : themePreset

  useEffect(() => {
    setThemeMode(initial.theme.mode)
    setThemePreset(initial.theme.preset)
    setCustomTheme(savedCustomValues)
  }, [initial.theme.mode, initial.theme.preset, savedCustomValues])

  function resetDraftFromInitial() {
    clearLogoPreview(initial.logo_url)
    clearFaviconPreview(initial.favicon_url)
    setThemeMode(initial.theme.mode)
    setThemePreset(initial.theme.preset)
    setCustomTheme(savedCustomValues)
  }

  function closeBrandingDrawer() {
    resetDraftFromInitial()
    setDrawerOpen(false)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        logo: state.logoFile,
        favicon: state.faviconFile,
        theme_mode: themeMode,
        theme_preset: themePreset,
        theme_custom: customTheme,
      }),
    onSuccess: (saved) => {
      clearLogoPreview(saved.logo_url)
      clearFaviconPreview(saved.favicon_url)
      setThemeMode(saved.theme.mode)
      setThemePreset(saved.theme.preset)
      setCustomTheme(saved.theme.custom ?? BRANDING_THEME_PRESETS[saved.theme.preset])
      queryClient.invalidateQueries({ queryKey: brandingQueryKey })
      setDrawerOpen(false)
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
    <>
      <Card data-settings-row className="rounded-lg border-border/70 py-0 shadow-xs">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
              <Palette className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm leading-5">{t('admin.settings.branding.assetsTitle')}</CardTitle>
                <ProBadge tooltip={t('admin.settings.proLockedWhiteLabel')} />
              </div>
              <CardDescription className="max-w-2xl leading-5">
                {t('admin.settings.branding.assetsDescription')}
              </CardDescription>
              <p className="text-muted-foreground text-sm">
                {disabled
                  ? t('admin.settings.branding.lockedMessage')
                  : t(`admin.settings.branding.themePresets.${initial.theme.preset}`)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Eye className="mr-2 size-4" />
                  {t('admin.settings.branding.preview')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{t('admin.settings.branding.preview')}</DialogTitle>
                  <DialogDescription>{t('admin.settings.branding.previewHint')}</DialogDescription>
                </DialogHeader>
                <ThemePreview values={previewTheme} logoUrl={state.previewLogoUrl} />
              </DialogContent>
            </Dialog>
            <Button type="button" size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
              {t('common.edit')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AdminFormDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          if (open) setDrawerOpen(true)
          else closeBrandingDrawer()
        }}
        width="extra-wide"
        title={t('admin.settings.branding.assetsTitle')}
        description={t('admin.settings.branding.assetsDescription')}
        bodyClassName="grid auto-rows-min content-start gap-4"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || resetMutation.isPending}
              onClick={() => resetMutation.mutate('theme')}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-2 size-4" />
              {t('admin.settings.branding.resetTheme')}
            </Button>
            <Button type="button" variant="outline" onClick={closeBrandingDrawer} disabled={saveMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={disabled || saveMutation.isPending}>
              {saveMutation.isPending ? t('admin.settings.branding.saving') : t('admin.settings.branding.save')}
            </Button>
          </>
        }
      >
        <div className={cn('grid auto-rows-min gap-4', disabled && 'opacity-60')}>
          <div className="grid gap-4 xl:grid-cols-2">
            <FileUploadField
              id="logo-upload"
              label={t('admin.settings.branding.logo')}
              hint={t('admin.settings.branding.logoHint')}
              emptyLabel={t('admin.settings.branding.upload')}
              replaceLabel={t('admin.settings.branding.replace')}
              resetLabel={t('admin.settings.branding.reset')}
              disabled={disabled}
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
              disabled={disabled}
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
              previewUrl={state.faviconPreviewUrl}
              onFileChange={setFaviconFile}
              onReset={() => resetMutation.mutate('favicon')}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminFormField
              id="theme-mode"
              label={t('admin.settings.branding.themeMode')}
              help={t('admin.settings.branding.themeDescription')}
              required
            >
              <Select
                value={themeSourceValue}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === 'custom') {
                    setThemeMode('custom')
                    return
                  }
                  setThemeMode('preset')
                  setThemePreset(value as BrandingThemePresetId)
                }}
              >
                <SelectTrigger id="theme-mode" className="w-full">
                  <SelectValue placeholder={t('admin.settings.branding.themeModePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESET_IDS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {t(`admin.settings.branding.themePresets.${preset}`)}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">{t('admin.settings.branding.themeModeCustom')}</SelectItem>
                </SelectContent>
              </Select>
            </AdminFormField>
            <ThemeColorInput
              id="theme-primary"
              label={t('admin.settings.branding.themePrimary')}
              placeholder={t('admin.settings.branding.colorPlaceholder')}
              value={previewTheme.primary_color}
              disabled={disabled || themeMode !== 'custom'}
              onChange={(primary_color) => setCustomTheme({ ...customTheme, primary_color })}
            />
            <ThemeColorInput
              id="theme-primary-foreground"
              label={t('admin.settings.branding.themePrimaryForeground')}
              placeholder={t('admin.settings.branding.colorPlaceholder')}
              value={previewTheme.primary_foreground}
              disabled={disabled || themeMode !== 'custom'}
              onChange={(primary_foreground) => setCustomTheme({ ...customTheme, primary_foreground })}
            />
            <ThemeColorInput
              id="theme-canvas"
              label={t('admin.settings.branding.themeCanvas')}
              placeholder={t('admin.settings.branding.colorPlaceholder')}
              value={previewTheme.canvas_color}
              disabled={disabled || themeMode !== 'custom'}
              onChange={(canvas_color) => setCustomTheme({ ...customTheme, canvas_color })}
            />
            <ThemeColorInput
              id="theme-sidebar-accent"
              label={t('admin.settings.branding.themeSidebarAccent')}
              placeholder={t('admin.settings.branding.colorPlaceholder')}
              value={previewTheme.sidebar_accent_color}
              disabled={disabled || themeMode !== 'custom'}
              onChange={(sidebar_accent_color) => setCustomTheme({ ...customTheme, sidebar_accent_color })}
            />
            <ThemeColorInput
              id="theme-ring"
              label={t('admin.settings.branding.themeRing')}
              placeholder={t('admin.settings.branding.colorPlaceholder')}
              value={previewTheme.ring_color}
              disabled={disabled || themeMode !== 'custom'}
              onChange={(ring_color) => setCustomTheme({ ...customTheme, ring_color })}
            />
          </div>
        </div>
      </AdminFormDrawer>
    </>
  )
}
