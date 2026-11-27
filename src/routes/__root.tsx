import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import { MusicPlayerProvider } from '@/components/music/music-player-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UploadQueueProvider } from '@/components/upload/upload-queue'
import { useDocumentDirection } from '@/hooks/use-document-direction'

interface RouterContext {
  queryClient: QueryClient
}

function RootLayout() {
  useDocumentDirection()
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <MusicPlayerProvider>
          <UploadQueueProvider>
            <Outlet />
          </UploadQueueProvider>
        </MusicPlayerProvider>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})
