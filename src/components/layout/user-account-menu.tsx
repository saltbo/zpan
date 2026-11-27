import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LanguageMenuSub } from '@/components/layout/language-menu'
import { ThemeMenuSub } from '@/components/layout/theme-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { signOut, useSession } from '@/lib/auth-client'
import { getInitials } from '@/lib/format'

export function UserAccountMenu({
  showAdminLink = false,
  showFrontendLinks = false,
}: {
  showAdminLink?: boolean
  showFrontendLinks?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: session } = useSession()
  const user = session?.user as { name: string; username?: string; role?: string; image?: string | null } | undefined
  const isAdmin = user?.role === 'admin'

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="flex-1 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
          <Avatar size="sm">
            <AvatarImage src={user?.image ?? undefined} alt={user?.name || user?.username || ''} />
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
              {user ? getInitials(user.name || user.username || '?') : '?'}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-left font-medium">{user?.name || user?.username}</span>
          <ChevronsUpDown className="ml-auto size-4 opacity-60" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        {showFrontendLinks && user?.username && (
          <DropdownMenuItem asChild>
            <Link to="/u/$username" params={{ username: user.username }}>
              <UserRound className="mr-2 h-4 w-4" />
              {t('nav.profile')}
            </Link>
          </DropdownMenuItem>
        )}
        {showFrontendLinks && (
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </Link>
          </DropdownMenuItem>
        )}
        <ThemeMenuSub />
        <LanguageMenuSub />
        {showAdminLink && isAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
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
  )
}
