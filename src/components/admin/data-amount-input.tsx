import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const DATA_UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const

export type DataUnit = keyof typeof DATA_UNITS

// A number with a unit is one control with a suffix selector (UX.md, Forms).
export function DataAmountInput({
  id,
  describedBy,
  value,
  unit,
  min,
  step = 1,
  placeholder,
  disabled,
  required,
  onValueChange,
  onUnitChange,
}: {
  id: string
  describedBy?: string
  value: string
  unit: DataUnit
  min: number
  step?: number
  placeholder?: string
  disabled?: boolean
  required?: boolean
  onValueChange: (value: string) => void
  onUnitChange: (unit: DataUnit) => void
}) {
  return (
    <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 dark:bg-input/30">
      <Input
        id={id}
        aria-describedby={describedBy}
        type="number"
        min={min}
        step={step}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-required={required ? true : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-8 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Select value={unit} disabled={disabled} onValueChange={(nextUnit) => onUnitChange(nextUnit as DataUnit)}>
        <SelectTrigger className="h-8 w-20 rounded-none border-0 border-l bg-transparent px-2 shadow-none focus-visible:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DATA_UNITS) as DataUnit[]).map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
