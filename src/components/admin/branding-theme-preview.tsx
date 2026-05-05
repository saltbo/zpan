import type { BrandingThemeValues } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const HEX6_RE = /^#[0-9a-fA-F]{6}$/

export function ThemePreview({ values }: { values: BrandingThemeValues }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex min-h-48" style={{ backgroundColor: values.canvas_color }}>
        <div className="w-20 border-r border-border/50 bg-sidebar p-3">
          <div className="mb-4 h-6 w-6 rounded-md" style={{ backgroundColor: values.primary_color }} />
          <div className="space-y-2">
            <div className="h-7 rounded-md" style={{ backgroundColor: values.sidebar_accent_color }} />
            <div className="h-7 rounded-md bg-background/70" />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between p-4">
          <div className="space-y-2">
            <div className="h-4 w-24 rounded-full bg-foreground/20" />
            <div className="h-16 rounded-md bg-background shadow-xs" />
          </div>
          <button
            type="button"
            className="h-9 rounded-md px-4 text-sm font-medium"
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
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="color"
          value={HEX6_RE.test(value) ? value : '#000000'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-12 shrink-0 px-1 py-1"
        />
        <Input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  )
}
