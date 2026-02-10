import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function DefaultPendingComponent() {
  return (
    <div className="fixed inset-x-0 top-0 z-[9999] h-[3px] overflow-hidden bg-nothing-green/10">
      <div
        className="h-full w-1/2 bg-nothing-green"
        style={{ animation: 'route-pending-bar 1s ease-in-out infinite' }}
      />
    </div>
  )
}

function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPendingComponent: DefaultPendingComponent,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
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
