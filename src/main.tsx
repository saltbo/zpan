import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrandingProvider } from './components/branding/BrandingProvider'
import i18n, { i18nReady } from './i18n'
import { applyDocumentDirection } from './lib/document-direction'
import { routeTree } from './routeTree.gen'
import './styles/globals.css'

const queryClient = new QueryClient()
const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

i18nReady.then(() => {
  // The direction has to be on <html> before the first render: Radix menu roots
  // bake `dir` in at mount, so menus mount with the right direction.
  applyDocumentDirection(i18n)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <RouterProvider router={router} />
        </BrandingProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
})
