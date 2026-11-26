import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'

type Search = Record<string, unknown>
type NavigateOptions = { to?: string; search?: Search | ((prev: Search) => Search); replace?: boolean }

// Stands in for the router's search state in route tests: the page reads its list
// state from `search`, and every navigate replaces it, as the URL would. A test file
// mocks `@tanstack/react-router` with `useSearch` and `useNavigate` from here.
function createRouterSearch() {
  let search: Search = {}
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const navigate = vi.fn((options: NavigateOptions) => {
    if (options.search === undefined) return
    const next = typeof options.search === 'function' ? options.search(search) : options.search
    search = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))
    for (const listener of listeners) listener()
  })

  return {
    navigate,
    useNavigate: () => navigate,
    useSearch: () => useSyncExternalStore(subscribe, () => search),
    get search() {
      return search
    },
    /** Opens the page at a URL with this search, as a reload or shared link would. */
    reset(initial: Search = {}) {
      search = initial
      navigate.mockClear()
    },
  }
}

export const routerSearch = createRouterSearch()
