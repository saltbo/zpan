import type { BrandingConfig, BrandingField } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { brandingQueryKey } from '@/components/branding/BrandingProvider'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
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
  accept,
  previewUrl,
  onFileChange,
  onReset,
}: {
  id: string
  label: string
  accept: string
  previewUrl: string | null
  onFileChange: (file: File | null) => void
  onReset: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        {previewUrl && (
          <img src={previewUrl} alt={label} className="h-10 w-10 rounded border object-contain bg-muted/40" />
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          {previewUrl ? 'Replace' : 'Upload'}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}

function LivePreview({ branding }: { branding: BrandingConfig }) {
  const { siteName } = useSiteOptions()
  const logoSrc = branding.logo_url ?? '/logo.svg'

  return (
    <div className="rounded-lg border bg-sidebar p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live Preview</p>
      <div className="flex items-center gap-2.5 border-b border-border/50 pb-3">
        <img src={logoSrc} alt={siteName} className="size-8 rounded object-contain" />
        <span className="text-lg font-semibold">{siteName}</span>
      </div>
      {!branding.hide_powered_by && <p className="text-xs text-muted-foreground/60 text-center">Powered by ZPan</p>}
    </div>
  )
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export function BrandingSection() {
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const { data: branding, isLoading: brandingLoading } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: getBranding,
    staleTime: 5 * 60 * 1000,
  })

  if (entitlementLoading || brandingLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading branding settings...</div>
  }

  if (!hasFeature('white_label')) {
    return <UpgradeHint feature="white_label" />
  }

  return (
    <BrandingForm
      initial={branding ?? { logo_url: null, favicon_url: null, wordmark_text: null, hide_powered_by: false }}
    />
  )
}

function BrandingForm({ initial }: { initial: BrandingConfig }) {
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
      toast.success('Branding saved')
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
      toast.success(`${field} reset to default`)
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-6">
        <div className="rounded-md border p-4 space-y-5">
          <h3 className="text-sm font-medium text-muted-foreground">Logo & Favicon</h3>
          <FileUploadField
            id="logo-upload"
            label="Logo"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            previewUrl={state.previewLogoUrl}
            onFileChange={setLogoFile}
            onReset={() => resetMutation.mutate('logo')}
          />
          <FileUploadField
            id="favicon-upload"
            label="Favicon"
            accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
            previewUrl={state.faviconPreviewUrl}
            onFileChange={setFaviconFile}
            onReset={() => resetMutation.mutate('favicon')}
          />
        </div>

        <div className="rounded-md border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="hide-powered-by">Hide "Powered by ZPan"</Label>
              <p className="text-xs text-muted-foreground">Remove the footer credit from the sidebar.</p>
            </div>
            <Switch id="hide-powered-by" checked={state.hidePoweredBy} onCheckedChange={setHidePoweredBy} />
          </div>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save branding'}
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Preview</p>
        <LivePreview branding={previewBranding} />
      </div>
    </div>
  )
}
