import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '@shared/constants'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, Moon, Settings, ShieldCheck, Sun, UserRound } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useBranding } from '@/components/branding/BrandingProvider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSiteConfig } from '@/hooks/use-site-config'
import { signOut, useSession } from '@/lib/auth-client'
import { getInitials } from '@/lib/format'

interface PublicLayoutProps {
  children: ReactNode
}

type PublicUser = {
  name?: string
  username?: string
  role?: string
  image?: string | null
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const { data: siteConfig } = useSiteConfig()
  const { branding } = useBranding()
  const { data: session } = useSession()
  const user = session?.user as PublicUser | undefined
  const siteName = siteConfig?.site.name ?? DEFAULT_SITE_NAME
  const siteDescription = siteConfig?.site.description ?? DEFAULT_SITE_DESCRIPTION
  const logoUrl = branding.logo_url ?? '/logo.png'
  const displayName = user?.name || user?.username || ''
  const isAdmin = user?.role === 'admin'
  const year = new Date().getFullYear()

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  function toggleTheme() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#public-content"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:ring-2 focus:ring-ring"
      >
        {t('public.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-full w-full max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src={logoUrl} alt="" className="size-9 shrink-0 object-contain" />
            <span className="truncate text-base font-semibold">{siteName}</span>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={toggleTheme}
              aria-label={t('public.toggleTheme')}
            >
              {resolvedTheme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </Button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar size="sm">
                      {user.image && <AvatarImage src={user.image} alt={displayName} />}
                      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                        {getInitials(displayName || '?')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-32 truncate font-medium sm:block">{displayName}</span>
                    <ChevronsUpDown className="hidden size-4 opacity-60 sm:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {user.username && (
                    <DropdownMenuItem asChild>
                      <Link to="/u/$username" params={{ username: user.username }}>
                        <UserRound className="mr-2 size-4" />
                        {t('nav.profile')}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <Settings className="mr-2 size-4" />
                      {t('nav.settings')}
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link to="/admin">
                        <ShieldCheck className="mr-2 size-4" />
                        {t('nav.adminPanel')}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 size-4" />
                    {t('auth.signOut')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild variant="outline" className="h-11 px-4">
                <Link to="/sign-in">{t('auth.signIn')}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="public-content" className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={logoUrl} alt="" className="size-8 shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{siteName}</p>
              <p className="truncate text-xs">{siteDescription || t('share.externalTagline')}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-xs sm:items-end">
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
                  className="text-foreground/70 transition-colors hover:text-foreground"
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
