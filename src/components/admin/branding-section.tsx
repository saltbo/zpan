import type { BrandingConfig, BrandingField } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, ImageUp, Palette, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { brandingQueryKey } from '@/components/branding/BrandingProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSiteOptions } from '@/hooks/use-site-options'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getBranding, resetBrandingField, saveBranding } from '@/lib/api'

// ─── Hooks ────────────────────────────────────────────────────────────────────

interface BrandingFormState {
  logoFile: File | null
  faviconFile: File | null
  hidePoweredBy: boolean
  previewLogoUrl: string | null
  faviconPreviewUrl: string | null
}

function useBrandingFormState(initial: BrandingConfig): {
  state: BrandingFormState
  setLogoFile: (f: File | null) => void
  setFaviconFile: (f: File | null) => void
  setHidePoweredBy: (v: boolean) => void
} {
  const [logoFile, setLogoFileRaw] = useState<File | null>(null)
  const [faviconFile, setFaviconFileRaw] = useState<File | null>(null)
  const [hidePoweredBy, setHidePoweredBy] = useState(initial.hide_powered_by)
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

  useEffect(() => {
    return () => {
      if (prevLogoBlob.current) URL.revokeObjectURL(prevLogoBlob.current)
      if (prevFaviconBlob.current) URL.revokeObjectURL(prevFaviconBlob.current)
    }
  }, [])

  return {
    state: { logoFile, faviconFile, hidePoweredBy, previewLogoUrl, faviconPreviewUrl },
    setLogoFile,
    setFaviconFile,
    setHidePoweredBy,
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function LivePreview({ branding }: { branding: BrandingConfig }) {
  const { t } = useTranslation()
  const { siteName } = useSiteOptions()
  const logoSrc = branding.logo_url ?? '/logo.svg'

  return (
    <div className="rounded-[24px] border border-border/60 bg-gradient-to-br from-sidebar via-background to-muted/40 p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <Eye className="h-4 w-4" />
        <span>{t('admin.settings.branding.preview')}</span>
      </div>
      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-border/60 bg-background/90 p-4">
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <img src={logoSrc} alt={siteName} className="size-9 rounded-lg object-contain" />
            <span className="text-lg font-semibold">{siteName}</span>
          </div>
          <div className="pt-3">
            {!branding.hide_powered_by && (
              <p className="text-xs text-center text-muted-foreground/70">{t('admin.settings.branding.poweredBy')}</p>
            )}
            {branding.hide_powered_by && (
              <p className="text-xs text-center text-muted-foreground/70">
                {t('admin.settings.branding.poweredHidden')}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4">
          <p className="text-sm font-medium">{t('admin.settings.branding.previewHintTitle')}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('admin.settings.branding.previewHint')}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main Section ─────────────────────────────────────────────────────────────

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

  return (
    <BrandingForm
      disabled={!hasFeature('white_label')}
      initial={branding ?? { logo_url: null, favicon_url: null, wordmark_text: null, hide_powered_by: false }}
    />
  )
}

function BrandingForm({ initial, disabled }: { initial: BrandingConfig; disabled: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { state, setLogoFile, setFaviconFile, setHidePoweredBy } = useBrandingFormState(initial)

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        logo: state.logoFile,
        favicon: state.faviconFile,
        hide_powered_by: state.hidePoweredBy,
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
      if (field === 'logo') setLogoFile(null)
      if (field === 'favicon') setFaviconFile(null)
      if (field === 'hide_powered_by') setHidePoweredBy(false)
      toast.success(t('admin.settings.branding.resetSuccess', { field: t(`admin.settings.branding.fields.${field}`) }))
    },
    onError: (err) => toast.error(err.message),
  })

  const previewBranding: BrandingConfig = {
    logo_url: state.previewLogoUrl,
    favicon_url: state.faviconPreviewUrl,
    wordmark_text: null,
    hide_powered_by: state.hidePoweredBy,
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
      <div className="space-y-6">
        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
                <Palette className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{t('admin.settings.branding.assetsTitle')}</CardTitle>
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
                <p>{t('admin.settings.branding.lockedMessage')}</p>
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
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="space-y-1">
            <CardTitle>{t('admin.settings.branding.visibilityTitle')}</CardTitle>
            <CardDescription>{t('admin.settings.branding.visibilityDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background p-4">
              <div className="space-y-0.5">
                <Label htmlFor="hide-powered-by">{t('admin.settings.branding.hidePoweredBy')}</Label>
                <p className="text-xs text-muted-foreground">{t('admin.settings.branding.hidePoweredByHint')}</p>
              </div>
              <Switch
                id="hide-powered-by"
                checked={state.hidePoweredBy}
                disabled={disabled}
                onCheckedChange={setHidePoweredBy}
              />
            </div>
          </CardContent>
        </Card>

        <Button onClick={() => saveMutation.mutate()} disabled={disabled || saveMutation.isPending}>
          {saveMutation.isPending ? t('admin.settings.branding.saving') : t('admin.settings.branding.save')}
        </Button>
      </div>
      <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
        <LivePreview branding={previewBranding} />
      </div>
    </div>
  )
}
