import type { BrandingConfig, BrandingField } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageUp, Palette, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { brandingQueryKey } from '@/components/branding/BrandingProvider'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getBranding, resetBrandingField, saveBranding } from '@/lib/api'

// ─── Hooks ────────────────────────────────────────────────────────────────────

interface BrandingFormState {
  logoFile: File | null
  faviconFile: File | null
  previewLogoUrl: string | null
  faviconPreviewUrl: string | null
}

function useBrandingFormState(initial: BrandingConfig): {
  state: BrandingFormState
  setLogoFile: (f: File | null) => void
  setFaviconFile: (f: File | null) => void
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
  const { state, setLogoFile, setFaviconFile } = useBrandingFormState(initial)

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBranding({
        logo: state.logoFile,
        favicon: state.faviconFile,
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
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={disabled || saveMutation.isPending}>
        {saveMutation.isPending ? t('admin.settings.branding.saving') : t('admin.settings.branding.save')}
      </Button>
    </div>
  )
}
