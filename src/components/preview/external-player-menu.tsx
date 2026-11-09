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
import { detectPlatform, playersForPlatform } from '@/lib/external-players'

interface ExternalPlayerMenuProps {
  url: string
  variant?: 'outline' | 'ghost'
}

export function ExternalPlayerMenu({ url, variant = 'outline' }: ExternalPlayerMenuProps) {
  const { t } = useTranslation()
  const players = playersForPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints))

  function copyLink() {
    navigator.clipboard.writeText(url).then(
      () => toast.success(t('preview.linkCopied')),
      () => toast.error(t('preview.copyLinkFailed')),
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm">
          <MonitorPlayIcon className="mr-2 size-4" />
          {t('preview.openWith')}
          <ChevronDownIcon className="ml-1 size-4" />
        </Button>
      </DropdownMenuTrigger>
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
    </DropdownMenu>
  )
}
