import { zodResolver } from '@hookform/resolvers/zod'
import type { Storage } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { type ComponentProps, forwardRef, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createStorage, updateStorage } from '@/lib/api'
import { eplistEndpointUrl, findEplistProvider, listEplistEndpoints, listEplistProviders } from '@/lib/eplist'

const storageFormSchema = z.object({
  provider: z.string(),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  forcePathStyle: z.boolean(),
})

type StorageFormValues = z.infer<typeof storageFormSchema>

const DEFAULT_VALUES: StorageFormValues = {
  provider: '',
  bucket: '',
  endpoint: '',
  region: 'auto',
  accessKey: '',
  secretKey: '',
  customHost: '',
  forcePathStyle: true,
}

const PREVIEW_OBJECT_KEY = 'example-object'

interface StorageFormDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage: Storage | null
}

export function StorageFormDrawer({ open, onOpenChange, storage }: StorageFormDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showSecret, setShowSecret] = useState(false)
  const isEditing = storage !== null
  const providersQuery = useQuery({
    queryKey: ['eplist', 'providers'],
    queryFn: listEplistProviders,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const form = useForm<StorageFormValues>({
    resolver: zodResolver(storageFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!open) return
    if (storage) {
      form.reset({
        provider: storage.provider,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        customHost: storage.customHost || '',
        forcePathStyle: storage.forcePathStyle ?? true,
      })
    } else {
      form.reset(DEFAULT_VALUES)
    }
    setShowSecret(false)
  }, [open, storage, form])

  const mutation = useMutation({
    mutationFn: (values: StorageFormValues) => (isEditing ? updateStorage(storage.id, values) : createStorage(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      onOpenChange(false)
      toast.success(isEditing ? t('admin.storages.updated') : t('admin.storages.created'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function onSubmit(values: StorageFormValues) {
    mutation.mutate(values)
  }

  const provider = form.watch('provider')
  const bucket = form.watch('bucket')
  const endpoint = form.watch('endpoint')
  const region = form.watch('region')
  const customHost = form.watch('customHost')
  const forcePathStyle = form.watch('forcePathStyle')
  const providers = providersQuery.data ?? []
  const selectedProvider = findEplistProvider(providers, provider)
  const preview = useMemo(
    () => buildStoragePreview({ bucket, endpoint, region, customHost, forcePathStyle }),
    [bucket, endpoint, region, customHost, forcePathStyle],
  )
  const endpointsQuery = useQuery({
    queryKey: ['eplist', 'endpoints', selectedProvider?.slug],
    queryFn: () => {
      if (!selectedProvider) throw new Error('provider_not_selected')
      return listEplistEndpoints(selectedProvider)
    },
    enabled: Boolean(selectedProvider),
    staleTime: 24 * 60 * 60 * 1000,
  })
  const endpointOptions = endpointsQuery.data ?? []
  const regionOptions = useMemo(() => {
    const regions = new Set<string>()
    for (const item of endpointOptions) regions.add(item.region)
    return Array.from(regions).map((region) => ({ value: region }))
  }, [endpointOptions])

  function handleProviderChange(value: string) {
    form.setValue('provider', value, { shouldDirty: true })
    form.setValue('endpoint', '', { shouldDirty: true, shouldValidate: true })
    form.setValue('region', '', { shouldDirty: true, shouldValidate: true })
  }

  function handleEndpointChange(value: string) {
    form.setValue('endpoint', value, { shouldDirty: true, shouldValidate: true })
    const normalized = value.replace(/^https?:\/\//i, '')
    const selectedEndpoint = endpointOptions.find((item) => item.endpoint === normalized)
    if (selectedEndpoint) {
      form.setValue('region', selectedEndpoint.region, { shouldDirty: true, shouldValidate: true })
    }
  }

  function handleRegionChange(value: string) {
    form.setValue('region', value, { shouldDirty: true, shouldValidate: true })
    const selectedEndpoint = endpointOptions.find((item) => item.region === value)
    if (selectedEndpoint) {
      form.setValue('endpoint', eplistEndpointUrl(selectedEndpoint.endpoint), {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? t('admin.storages.editTitle') : t('admin.storages.addTitle')}
      bodyClassName="grid auto-rows-min content-start gap-4"
      formProps={{ onSubmit: form.handleSubmit(onSubmit) }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <AdminFormField
        id="storage-provider"
        label={t('admin.storages.fieldProvider')}
        help={t('admin.storages.providerHint')}
        error={form.formState.errors.provider?.message}
      >
        {(controlProps) => (
          <FreeInputDropdown
            {...form.register('provider')}
            {...controlProps}
            value={provider}
            placeholder={t('admin.storages.providerPlaceholder')}
            options={providers.map((item) => ({ value: item.slug, label: item.displayName }))}
            disabled={isEditing}
            onValueChange={handleProviderChange}
          />
        )}
      </AdminFormField>

      <AdminFormField
        id="storage-bucket"
        label={t('admin.storages.fieldBucket')}
        required
        error={form.formState.errors.bucket?.message}
      >
        <Input {...form.register('bucket')} placeholder={t('admin.storages.bucketPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-endpoint"
        label={t('admin.storages.fieldEndpoint')}
        required
        error={form.formState.errors.endpoint?.message}
      >
        {(controlProps) => (
          <FreeInputDropdown
            {...form.register('endpoint')}
            {...controlProps}
            value={endpoint}
            placeholder={t('admin.storages.endpointPlaceholder')}
            options={endpointOptions.map((item) => ({
              value: eplistEndpointUrl(item.endpoint),
              label: eplistEndpointUrl(item.endpoint),
              description: item.region,
            }))}
            onValueChange={handleEndpointChange}
          />
        )}
      </AdminFormField>

      <AdminFormField
        id="storage-region"
        label={t('admin.storages.fieldRegion')}
        required
        error={form.formState.errors.region?.message}
      >
        {(controlProps) => (
          <FreeInputDropdown
            {...form.register('region')}
            {...controlProps}
            value={region}
            placeholder={t('admin.storages.regionPlaceholder')}
            options={regionOptions}
            onValueChange={handleRegionChange}
          />
        )}
      </AdminFormField>

      <AdminFormField
        id="storage-access-key"
        label={t('admin.storages.fieldAccessKey')}
        required
        error={form.formState.errors.accessKey?.message}
      >
        <Input {...form.register('accessKey')} placeholder={t('admin.storages.accessKeyPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-secret-key"
        label={t('admin.storages.fieldSecretKey')}
        required
        error={form.formState.errors.secretKey?.message}
      >
        {(controlProps) => (
          <div className="relative">
            <Input
              {...form.register('secretKey')}
              {...controlProps}
              type={showSecret ? 'text' : 'password'}
              placeholder={t('admin.storages.secretKeyPlaceholder')}
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={showSecret ? t('admin.storages.hideSecretKey') : t('admin.storages.showSecretKey')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </AdminFormField>

      <AdminFormField
        id="storage-custom-host"
        label={t('admin.storages.fieldCustomHost')}
        help={t('admin.storages.customHostHint')}
        error={form.formState.errors.customHost?.message}
      >
        <Input {...form.register('customHost')} placeholder={t('admin.storages.customHostPlaceholder')} />
      </AdminFormField>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <AdminFormLabel htmlFor="forcePathStyle" help={t('admin.storages.forcePathStyleHint')}>
            {t('admin.storages.fieldForcePathStyle')}
          </AdminFormLabel>
        </div>
        <Switch
          id="forcePathStyle"
          className="mt-0.5"
          checked={forcePathStyle}
          onCheckedChange={(checked) => form.setValue('forcePathStyle', checked)}
        />
      </div>

      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-sm">{t('admin.storages.previewTitle')}</p>
          {preview && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {t(
                preview.addressingMode === 'path'
                  ? 'admin.storages.previewPathStyle'
                  : 'admin.storages.previewVirtualHostedStyle',
              )}
            </span>
          )}
        </div>
        {preview ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">{t('admin.storages.previewRequestUrl')}</p>
              <code className="block break-all rounded-sm bg-background px-2 py-1.5 text-xs">{preview.requestUrl}</code>
            </div>
            {preview.publicUrl !== preview.requestUrl && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{t('admin.storages.previewPublicUrl')}</p>
                <code className="block break-all rounded-sm bg-background px-2 py-1.5 text-xs">
                  {preview.publicUrl}
                </code>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {t('admin.storages.previewSigningRegion', { region: preview.signingRegion })}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t('admin.storages.previewEmpty')}</p>
        )}
      </div>
    </AdminFormDrawer>
  )
}

type StoragePreviewInput = Pick<StorageFormValues, 'bucket' | 'endpoint' | 'region' | 'customHost' | 'forcePathStyle'>

function buildStoragePreview({ bucket, endpoint, region, customHost, forcePathStyle }: StoragePreviewInput) {
  const normalizedBucket = bucket.trim()
  const normalizedEndpoint = endpoint.trim()
  if (!normalizedBucket || !normalizedEndpoint) return null

  let url: URL
  try {
    url = new URL(normalizedEndpoint)
  } catch {
    return null
  }

  url.search = ''
  url.hash = ''

  const endpointPath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  const shouldUsePathStyle = forcePathStyle || isIpAddress(url.hostname)
  if (shouldUsePathStyle) {
    url.pathname = joinPath(endpointPath, normalizedBucket, PREVIEW_OBJECT_KEY)
    const requestUrl = url.toString()
    return {
      requestUrl,
      publicUrl: buildPublicPreviewUrl(requestUrl, customHost),
      addressingMode: 'path' as const,
      signingRegion: region.trim() || 'auto',
    }
  }

  url.hostname = `${normalizedBucket}.${url.hostname}`
  url.pathname = joinPath(endpointPath, PREVIEW_OBJECT_KEY)
  const requestUrl = url.toString()
  return {
    requestUrl,
    publicUrl: buildPublicPreviewUrl(requestUrl, customHost),
    addressingMode: 'virtual-hosted' as const,
    signingRegion: region.trim() || 'auto',
  }
}

function buildPublicPreviewUrl(requestUrl: string, customHost: string | undefined) {
  const normalizedCustomHost = customHost?.trim()
  if (!normalizedCustomHost) return requestUrl

  const url = new URL(requestUrl)
  const host = /^https?:\/\//i.test(normalizedCustomHost) ? normalizedCustomHost : `https://${normalizedCustomHost}`
  const hostUrl = new URL(host)
  url.protocol = hostUrl.protocol
  url.host = hostUrl.host
  return url.toString()
}

function joinPath(...parts: string[]): string {
  const path = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return `/${path}`
}

function isIpAddress(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')
}

type FreeInputDropdownOption = {
  value: string
  label?: string
  description?: string
}

interface FreeInputDropdownProps extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> {
  value: string
  options: FreeInputDropdownOption[]
  onValueChange: (value: string) => void
}

const FreeInputDropdown = forwardRef<HTMLInputElement, FreeInputDropdownProps>(function FreeInputDropdown(
  { value, options, onValueChange, onFocus, onBlur, onKeyDown, ...inputProps },
  ref,
) {
  const [open, setOpen] = useState(false)
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase()
    const exactMatch = options.some((option) =>
      [option.value, option.label].some((part) => part?.toLowerCase() === query),
    )
    const filtered =
      query && !exactMatch
        ? options.filter((option) =>
            [option.value, option.label, option.description].some((part) => part?.toLowerCase().includes(query)),
          )
        : options
    return filtered.slice(0, 80)
  }, [options, value])
  const showOptions = open && filteredOptions.length > 0

  return (
    <div className="relative">
      <Input
        {...inputProps}
        ref={ref}
        value={value}
        autoComplete="off"
        role={options.length > 0 ? 'combobox' : undefined}
        aria-expanded={options.length > 0 ? showOptions : undefined}
        onFocus={(event) => {
          setOpen(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          window.setTimeout(() => setOpen(false), 100)
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          onKeyDown?.(event)
        }}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(true)
        }}
      />
      {showOptions && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filteredOptions.map((option) => (
            <button
              type="button"
              role="option"
              key={`${option.value}:${option.description ?? ''}`}
              className="flex w-full min-w-0 items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onValueChange(option.value)
                setOpen(false)
              }}
            >
              <span className="min-w-0 truncate">{option.label ?? option.value}</span>
              {option.description && (
                <span className="shrink-0 text-muted-foreground text-xs">{option.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
