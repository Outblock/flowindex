import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { runtimeDir } from 'nitro/meta'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    // TanStack Start SSR (Vite Environments: client + ssr)
    tanstackStart({
      // Our Start app lives in `app/` (not the default `src/`)
      srcDirectory: 'app',
      router: {
        // These are relative to `srcDirectory`
        routesDirectory: 'routes',
        generatedRouteTree: 'routeTree.gen.ts',
        autoCodeSplitting: true,
      },
    }),
    react(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),

    // Nitro is the production server runtime/output (.output/).
    // Force Vite-SSR handler (TanStack Start) instead of the default index.html template renderer.
    nitro({
      // Use Bun runtime in production container (see frontend/Dockerfile + entrypoint.sh).
      preset: 'bun',
      renderer: {
        handler: resolve(runtimeDir, 'internal/vite/ssr-renderer'),
      },
    }),
  ],

  // Keep the historical dev port for local workflows
  server: {
    port: 5173,
  },
})
