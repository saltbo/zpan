import type { ActorAttribution } from '@shared/schemas'
import type { AuditEvent } from '@shared/types'
import { Bot, CircleHelp, KeyRound, Monitor, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

export function ActorIdentity({ actor, compact = false, className }: ActorIdentityProps) {
  const { t } = useTranslation()
  if (!actor) {
    return <span className={cn('text-muted-foreground', className)}>{t('actors.notRecorded')}</span>
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={actor.name}>
      <Avatar size="sm">
        {actor.image && <AvatarImage src={actor.image} alt="" />}
        <AvatarFallback className="[&_svg]:size-3">{<ActorFallback actor={actor} />}</AvatarFallback>
      </Avatar>
      <span className={cn('min-w-0 truncate', compact ? 'text-xs text-muted-foreground' : 'text-sm')}>
        {actor.name}
      </span>
    </span>
  )
}
