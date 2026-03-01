import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['@onflow/cadence-language-server'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
