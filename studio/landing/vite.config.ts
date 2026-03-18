import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const packagesRoot = path.resolve(__dirname, '../../packages')
const nm = path.resolve(__dirname, 'node_modules')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Workspace packages → source
      '@flowindex/auth-ui': path.join(packagesRoot, 'auth-ui/src/index.ts'),
      '@flowindex/auth-core': path.join(packagesRoot, 'auth-core/src/index.ts'),
      '@flowindex/flow-passkey': path.join(packagesRoot, 'flow-passkey/src/index.ts'),
      // Ensure all deps resolve from our node_modules (needed in Docker where
      // workspace packages are at /packages/ but node_modules is at /app/)
      'react': path.join(nm, 'react'),
      'react-dom': path.join(nm, 'react-dom'),
      'framer-motion': path.join(nm, 'framer-motion'),
      'lucide-react': path.join(nm, 'lucide-react'),
      'input-otp': path.join(nm, 'input-otp'),
      '@onflow/rlp': path.join(nm, '@onflow/rlp'),
      'sha3': path.join(nm, 'sha3'),
    },
  },
  optimizeDeps: {
    include: ['@onflow/rlp', 'sha3', 'input-otp', 'framer-motion', 'lucide-react'],
  },
  server: {
    fs: {
      allow: [packagesRoot, '.'],
    },
  },
})
