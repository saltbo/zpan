import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, Languages, LogOut, Palette, Settings, ShieldCheck, Users } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
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
        {showFrontendLinks && (
          <>
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
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            <span>{t('settings.appearance.theme')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="system">{t('settings.appearance.themeSystem')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">{t('settings.appearance.themeLight')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('settings.appearance.themeDark')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages className="mr-2 h-4 w-4" />
            <span>{t('settings.appearance.language')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'}
              onValueChange={(lang) => i18n.changeLanguage(lang)}
            >
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {showAdminLink && isAdmin && (
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
  )
}
