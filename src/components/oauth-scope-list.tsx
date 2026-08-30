import { getOAuthScopeMetadata } from '@shared/oauth-scope-metadata'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface OAuthScopeGroup {
  id: string
  scopes: string[]
}

export function groupOAuthScopes(scopes: readonly string[]): OAuthScopeGroup[] {
  const groups = new Map<string, string[]>()
  for (const scope of scopes) {
    const separator = scope.indexOf(':')
    const id = separator === -1 ? 'oauth' : scope.slice(0, separator)
    groups.set(id, [...(groups.get(id) ?? []), scope])
  }
  return [...groups].map(([id, groupedScopes]) => ({ id, scopes: groupedScopes }))
}

export function OAuthScopeList({ scopes, className }: { scopes: readonly string[]; className?: string }) {
  const { i18n, t } = useTranslation()
  const language = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh') ? 'zh' : 'en'

  return (
    <div className={cn('space-y-5', className)}>
      {groupOAuthScopes(scopes).map((group) => (
        <section key={group.id} className="space-y-2" aria-labelledby={`scope-group-${group.id}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 id={`scope-group-${group.id}`} className="font-medium text-sm capitalize">
              {group.id.replaceAll('-', ' ')}
            </h3>
            <Badge variant="outline">{group.scopes.length}</Badge>
          </div>
          <div className="divide-y rounded-lg border">
            {group.scopes.map((scope) => {
              const metadata = getOAuthScopeMetadata(scope)
              return (
                <div key={scope} className="space-y-1 px-3 py-2.5">
                  <code className="block break-all font-medium text-xs">{scope}</code>
                  <p className={cn('text-sm', metadata ? 'text-muted-foreground' : 'text-destructive')}>
                    {metadata?.description[language] ?? t('settings.oauthApps.scopeDescriptionMissing')}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
