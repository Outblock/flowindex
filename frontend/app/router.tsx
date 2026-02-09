import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function createRouter() {
  return createTanStackRouter({
    routeTree,
  })
}

let browserRouter: ReturnType<typeof createRouter> | undefined

// TanStack Start runtime expects this export.
// - Browser: singleton router instance for hydration/navigation.
// - Server: new router per request to avoid cross-request state leaks.
export function getRouter() {
  if (typeof document !== 'undefined') {
    browserRouter ??= createRouter()
    return browserRouter
  }

  return createRouter()
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
