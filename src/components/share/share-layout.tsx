import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, Settings, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useBranding } from '@/components/branding/BrandingProvider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSiteOptions } from '@/hooks/use-site-options'
import { signOut, useSession } from '@/lib/auth-client'

interface ShareLayoutProps {
  children: ReactNode
  title?: string
  subtitle?: string
  meta?: string[]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ShareLayout({ children }: ShareLayoutProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { siteName, siteDescription } = useSiteOptions()
  const { branding } = useBranding()
  const { data: session } = useSession()
  const user = session?.user as { name?: string; username?: string; role?: string; image?: string | null } | undefined
  const displayName = user?.name || user?.username || ''
  const isAdmin = user?.role === 'admin'
  const year = new Date().getFullYear()

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-10 border-b bg-background/88 backdrop-blur supports-[backdrop-filter]:bg-background/72">
        <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card shadow-sm">
              <img src="/logo.svg" alt={siteName} className="size-6" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none">{siteName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {siteDescription || t('share.externalTagline')}
              </p>
            </div>
          </Link>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar size="sm">
                    {user.image && <AvatarImage src={user.image} alt={displayName} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {getInitials(displayName || '?')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate font-medium sm:block">{displayName}</span>
                  <ChevronsUpDown className="hidden size-4 opacity-60 sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t('nav.settings')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/teams">
                    <Users className="mr-2 h-4 w-4" />
                    {t('nav.teams')}
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin/storages">
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t('nav.adminPanel')}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('auth.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-5">{children}</main>

      <footer className="border-t bg-background/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={branding.logo_url ?? '/logo.svg'} alt={siteName} className="size-7 shrink-0" />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{siteName}</p>
              <p className="truncate">{siteDescription || t('share.externalTagline')}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <p>
              © {year} {siteName}
            </p>
            {!branding.hide_powered_by && (
              <p>
                Powered by{' '}
                <a
                  href="https://github.com/saltbo/zpan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/70 hover:text-foreground"
                >
                  ZPan
                </a>
              </p>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}
