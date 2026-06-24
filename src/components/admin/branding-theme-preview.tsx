import type { BrandingThemeValues } from '@shared/types'
import { AdminFormField } from '@/components/admin/admin-form-drawer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const HEX6_RE = /^#[0-9a-fA-F]{6}$/

export function ThemePreview({ values, logoUrl }: { values: BrandingThemeValues; logoUrl: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex min-h-96" style={{ backgroundColor: values.canvas_color }}>
        <div className="flex w-36 flex-col border-r border-border/50 bg-sidebar p-4">
          <div className="mb-5 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-background shadow-xs">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="size-6 rounded object-contain" />
              ) : (
                <div className="size-4 rounded" style={{ backgroundColor: values.primary_color }} />
              )}
            </div>
            <div className="h-3 w-16 rounded-full bg-sidebar-foreground/20" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-8 rounded-md" style={{ backgroundColor: values.sidebar_accent_color }} />
            <div className="h-8 rounded-md bg-background/70" />
            <div className="h-8 rounded-md bg-background/50" />
            <div className="h-8 rounded-md bg-background/40" />
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <div className="h-2 w-16 rounded-full bg-sidebar-foreground/20" />
            <div className="h-2 w-24 rounded-full bg-sidebar-foreground/15" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="h-4 w-28 rounded-full bg-foreground/25" />
              <div className="mt-2 h-2 w-36 rounded-full bg-foreground/15" />
            </div>
            <div className="size-8 rounded-full bg-background shadow-xs" />
          </div>
          <div className="rounded-lg bg-background p-4 shadow-xs">
            <div className="mb-4 h-3 w-32 rounded-full bg-foreground/20" />
            <div className="grid grid-cols-3 gap-3">
              <div className="h-20 rounded-md bg-muted" />
              <div className="h-20 rounded-md bg-muted" />
              <div className="h-20 rounded-md bg-muted" />
            </div>
          </div>
          <button
            type="button"
            className="mt-auto h-9 rounded-md px-4 text-sm font-medium"
            style={{
              backgroundColor: values.primary_color,
              color: values.primary_foreground,
              boxShadow: `0 0 0 3px ${values.ring_color}33`,
            }}
          >
            Theme
          </button>
        </div>
      </div>
    </div>
  )
}

export function ThemeColorInput({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <AdminFormField id={id} label={label} className={cn(disabled && 'opacity-60')}>
      <div className="flex gap-2">
        <Input
          id={id}
          type="color"
          value={HEX6_RE.test(value) ? value : '#000000'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-12 shrink-0 px-1 py-1"
        />
        <Input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </AdminFormField>
  )
}
