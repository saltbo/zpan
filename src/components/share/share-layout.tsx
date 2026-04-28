import { Link } from '@tanstack/react-router'
import { Clock3, Download, FolderTree, Globe2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSiteOptions } from '@/hooks/use-site-options'

interface ShareLayoutProps {
  children: ReactNode
  title: string
  subtitle: string
  meta?: string[]
}

export function ShareLayout({ children, title, subtitle, meta = [] }: ShareLayoutProps) {
  const { t } = useTranslation()
  const { siteName, siteDescription } = useSiteOptions()
  const year = new Date().getFullYear()

  return (
    <div className="flex min-h-screen flex-col bg-[linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.24))]">
      <header className="sticky top-0 z-10 border-b bg-background/88 backdrop-blur supports-[backdrop-filter]:bg-background/72">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-xl border bg-card shadow-sm">
              <img src="/logo.svg" alt={siteName} className="size-6" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none">{siteName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {siteDescription || t('share.externalTagline')}
              </p>
            </div>
          </Link>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <Globe2 className="size-3.5" />
            <span>{t('share.externalBadge')}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-3 sm:px-6 sm:py-4">
        <section className="mb-3 rounded-xl border bg-card shadow-sm">
          <div className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <FolderTree className="size-3.5" />
              <span>{t('share.externalLabel')}</span>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
                <p className="max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">{subtitle}</p>
              </div>
              {meta.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {meta.map((item) => (
                    <div
                      key={item}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <Clock3 className="size-3 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {children}
      </main>

      <footer className="border-t bg-background/80">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="leading-none">
            {siteName} © {year}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/" className="hover:text-foreground">
              {t('share.browseZPan')}
            </Link>
            <Link to="/sign-in" className="inline-flex items-center gap-1 leading-none hover:text-foreground">
              <Download className="size-3.5" />
              <span>{t('share.openWorkspace')}</span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
