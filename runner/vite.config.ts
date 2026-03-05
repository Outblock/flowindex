import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': '/src',
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['@onflow/cadence-language-server'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    proxy: {
      '/lsp': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
