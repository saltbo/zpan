import type { Announcement } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Megaphone, Pin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEntitlement } from '@/hooks/useEntitlement'
import { listActiveAnnouncements } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AnnouncementMarkdown } from './markdown-content'

const activeAnnouncementsQueryKey = ['announcements', 'active'] as const
const openAnnouncementsEvent = 'zpan:open-announcements'
const announcementAutoOpenPrefix = 'zpan:announcements:auto-open'

export function openAnnouncementsDialog() {
  window.dispatchEvent(new Event(openAnnouncementsEvent))
}

export function SiteAnnouncements() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [autoOpenKey, setAutoOpenKey] = useState<string | null>(null)
  const { hasFeature } = useEntitlement()
  const announcementsEnabled = hasFeature('site_announcements')

  const { data } = useQuery({
    queryKey: activeAnnouncementsQueryKey,
    queryFn: listActiveAnnouncements,
    enabled: announcementsEnabled,
  })

  const announcements = data?.items ?? []
  const latest = announcements[0]
  const latestAutoOpenKey = latest ? `${announcementAutoOpenPrefix}:${latest.id}:${latest.updatedAt}` : null

  useEffect(() => {
    function handleOpen() {
      if (latest) {
        setExpandedId(latest.id)
        setOpen(true)
      }
    }

    window.addEventListener(openAnnouncementsEvent, handleOpen)
    return () => window.removeEventListener(openAnnouncementsEvent, handleOpen)
  }, [latest])

  useEffect(() => {
    if (!latest || !latestAutoOpenKey || expandedId) return
    if (localStorage.getItem(latestAutoOpenKey)) return

    setExpandedId(latest.id)
    setAutoOpenKey(latestAutoOpenKey)
    setOpen(true)
  }, [latest, latestAutoOpenKey, expandedId])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen && autoOpenKey) {
      localStorage.setItem(autoOpenKey, 'closed')
      setAutoOpenKey(null)
    }
  }

  if (announcements.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            {t('announcement.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('announcement.description')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {announcements.map((announcement) => (
            <AnnouncementPanel
              key={announcement.id}
              announcement={announcement}
              expanded={expandedId === announcement.id}
              onToggle={() => setExpandedId(expandedId === announcement.id ? null : announcement.id)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AnnouncementPanel({
  announcement,
  expanded,
  onToggle,
}: {
  announcement: Announcement
  expanded: boolean
  onToggle: () => void
}) {
  const { i18n, t } = useTranslation()
  const date = announcement.publishedAt ?? announcement.createdAt
  const pinned = announcement.priority > 0

  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border bg-card transition-colors',
        pinned && 'border-primary/40 bg-primary/5 shadow-sm',
      )}
    >
      <Button
        variant="ghost"
        className={cn(
          'h-auto w-full justify-start rounded-none px-4 py-3 text-left hover:bg-muted/60',
          pinned && 'hover:bg-primary/10',
        )}
        onClick={onToggle}
      >
        <span className={cn('mr-3 h-10 w-1 rounded-full bg-transparent', pinned && 'bg-primary')} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-sm">{announcement.title}</span>
            {pinned && (
              <Badge variant="secondary" className="shrink-0 gap-1 border-primary/30 bg-background text-primary">
                <Pin className="h-3 w-3" />
                {t('announcement.pinned')}
              </Badge>
            )}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {new Date(date).toLocaleString(i18n.language)}
          </span>
        </span>
      </Button>
      {expanded && announcement.body && (
        <div className={cn('border-t px-4 py-3', pinned && 'border-primary/20 bg-background/60')}>
          <AnnouncementMarkdown content={announcement.body} />
        </div>
      )}
    </section>
  )
}
