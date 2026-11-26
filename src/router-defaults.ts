import { RouteErrorFallback } from './components/errors/route-error-fallback'

// Options every router instance gets, so a route without its own errorComponent never renders blank.
export const routerDefaults = {
  defaultErrorComponent: RouteErrorFallback,
}
