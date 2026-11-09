import { ChevronDownIcon, CopyIcon, MonitorPlayIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { detectPlatform, playersForPlatform } from '@/lib/external-players'

interface ExternalPlayerMenuProps {
  url: string
  /** Icon button for toolbars; otherwise a labelled button. */
  iconOnly?: boolean
  compact?: boolean
}

export function ExternalPlayerMenu({ url, iconOnly, compact }: ExternalPlayerMenuProps) {
  const { t } = useTranslation()
  const players = playersForPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints))
  const label = t('preview.openWith')

  function copyLink() {
    navigator.clipboard.writeText(url).then(
      () => toast.success(t('preview.linkCopied')),
      () => toast.error(t('preview.copyLinkFailed')),
    )
  }

  const menu = (
    <DropdownMenuContent align="end">
      {players.map((player) => (
        <DropdownMenuItem key={player.id} asChild>
          <a href={player.buildUrl(url)}>{player.name}</a>
        </DropdownMenuItem>
      ))}
      {players.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={copyLink}>
        <CopyIcon className="mr-2 size-4" />
        {t('preview.copyLink')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  if (iconOnly) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size={compact ? 'icon-xs' : 'icon-sm'} aria-label={label} title={label}>
                <MonitorPlayIcon className="size-4" />
                <span className="sr-only">{label}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        {menu}
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <MonitorPlayIcon className="mr-2 size-4" />
          {label}
          <ChevronDownIcon className="ml-1 size-4" />
        </Button>
      </DropdownMenuTrigger>
      {menu}
    </DropdownMenu>
  )
}
