import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routerDefaults } from '@/router-defaults'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

function renderRouterWith(loader: () => unknown, component: () => ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', loader, component })
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    ...routerDefaults,
  })
  return render(<RouterProvider router={router} />)
}

describe('router default error component', () => {
  it('replaces a route that fails to load with an error page, and retry reloads it [spec: load-errors/route-fallback]', async () => {
    let fail = true
    const loader = vi.fn(() => {
      if (fail) throw new Error('loader exploded')
      return null
    })
    renderRouterWith(loader, () => <p>page content</p>)

    expect(await screen.findByText('common.routeError.title')).toBeTruthy()
    // A non-API error never leaks its internal message to the user.
    expect(screen.getByText('common.routeError.description')).toBeTruthy()
    expect(screen.queryByText('loader exploded')).toBeNull()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(await screen.findByText('page content')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('catches a component that throws while rendering', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRouterWith(
      () => null,
      () => {
        throw new Error('render exploded')
      },
    )

    expect(await screen.findByText('common.routeError.title')).toBeTruthy()
  })
})
