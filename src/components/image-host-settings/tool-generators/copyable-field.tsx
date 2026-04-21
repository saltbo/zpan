import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ToolConfigField } from '@/lib/tool-configs'

export function CopyableField({ label, value }: ToolConfigField) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error('Copy failed'),
    )
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 rounded-md bg-muted px-2.5 py-1.5 text-xs font-mono break-all select-all">{value}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}
