import type { ActorAttribution } from '@shared/schemas'
import type { AuditEvent } from '@shared/types'
import { Bot, CircleHelp, KeyRound, Monitor, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

interface ActorIdentityProps {
  actor?: ActorAttribution | null
  compact?: boolean
  className?: string
}

export function auditEventActor(event: AuditEvent): ActorAttribution {
  return {
    type: event.actorType,
    ref: event.actorRef,
    issuer: event.actorIssuer,
    ...event.actor,
  }
}

function ActorFallback({ actor }: { actor: ActorAttribution }) {
  if (actor.type === 'api_key') return <KeyRound aria-hidden="true" />
  if (actor.type === 'device') return <Monitor aria-hidden="true" />
  if (actor.type === 'oauth' || actor.type === 'agent') return <Bot aria-hidden="true" />
  if (actor.type === 'user') {
    const initials = actor.name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    return initials || <UserRound aria-hidden="true" />
  }
  return <CircleHelp aria-hidden="true" />
}

function ActorAvatar({ actor, size = 'sm' }: { actor: ActorAttribution; size?: 'sm' | 'default' }) {
  return (
    <Avatar size={size}>
      {actor.image && <AvatarImage src={actor.image} alt="" />}
      <AvatarFallback className="[&_svg]:size-3">
        <ActorFallback actor={actor} />
      </AvatarFallback>
    </Avatar>
  )
}

export function ActorIdentity({ actor, compact = false, className }: ActorIdentityProps) {
  const { t } = useTranslation()
  if (!actor) {
    return <span className={cn('text-muted-foreground', className)}>{t('actors.notRecorded')}</span>
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={actor.name}>
      <ActorAvatar actor={actor} />
      <span className={cn('min-w-0 truncate', compact ? 'text-xs text-muted-foreground' : 'text-sm')}>
        {actor.name}
      </span>
    </span>
  )
}

export function ActorAvatarHoverCard({ actor, className }: Pick<ActorIdentityProps, 'actor' | 'className'>) {
  const { t } = useTranslation()
  if (!actor) {
    return <span className={cn('text-muted-foreground', className)}>{t('actors.notRecorded')}</span>
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={`${t('files.createdBy')}: ${actor.name}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ActorAvatar actor={actor} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72">
        <div className="flex items-start gap-3">
          <ActorAvatar actor={actor} size="default" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{actor.name}</span>
              <Badge variant="secondary">{t(`actors.type.${actor.type}`)}</Badge>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {actor.ref && (
                <>
                  <dt className="text-muted-foreground">{t('actors.ref')}</dt>
                  <dd className="min-w-0 break-all">{actor.ref}</dd>
                </>
              )}
              {actor.issuer && (
                <>
                  <dt className="text-muted-foreground">{t('actors.issuer')}</dt>
                  <dd className="min-w-0 break-all">{actor.issuer}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
