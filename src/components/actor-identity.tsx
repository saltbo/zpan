import type { ActorAttribution } from '@shared/schemas'
import type { AuditEvent } from '@shared/types'
import { Bot, CircleHelp, ExternalLink, KeyRound, Monitor, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Separator } from '@/components/ui/separator'
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

function ActorAvatar({ actor, size = 'sm' }: { actor: ActorAttribution; size?: 'sm' | 'default' | 'lg' }) {
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
            'inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={`${t('files.createdBy')}: ${actor.name}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ActorAvatar actor={actor} size="default" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-64 max-w-[calc(100vw-2rem)] overflow-hidden">
        <ActorProfileCardHeader actor={actor} />
        {(actor.ref || actor.issuer) && <Separator className="my-3" />}
        <dl className="flex min-w-0 flex-col gap-2 overflow-hidden text-xs">
          {actor.ref && (
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              <dt className="shrink-0 text-muted-foreground">{t('actors.ref')}</dt>
              <dd className="min-w-0 whitespace-normal break-all text-right font-mono" data-actor-field>
                {actor.ref}
              </dd>
            </div>
          )}
          {actor.issuer && (
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              <dt className="shrink-0 text-muted-foreground">{t('actors.issuer')}</dt>
              <dd className="min-w-0 whitespace-normal break-all text-right" data-actor-field>
                {actor.issuer}
              </dd>
            </div>
          )}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}

function ActorProfileCardHeader({ actor }: { actor: ActorAttribution }) {
  const { t } = useTranslation()
  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <ActorAvatar actor={actor} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1 overflow-hidden">
          <span className="block w-full min-w-0 whitespace-normal break-words text-sm font-semibold" data-actor-field>
            {actor.name}
          </span>
          <Badge variant="secondary" className="max-w-full min-w-0">
            <span className="min-w-0 truncate" data-actor-field>
              {t(`actors.type.${actor.type}`)}
            </span>
          </Badge>
        </div>
      </div>
      {actor.profileUrl && <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
    </>
  )

  if (!actor.profileUrl) return <div className="flex w-full min-w-0 items-center gap-3 overflow-hidden">{content}</div>

  return (
    <a
      href={actor.profileUrl}
      target="_blank"
      rel="noreferrer"
      className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => event.stopPropagation()}
    >
      {content}
    </a>
  )
}
