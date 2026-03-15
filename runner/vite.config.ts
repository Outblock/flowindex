import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['util', 'stream', 'buffer', 'process'],
    }),
  ],
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
      '/api/simulate/raw': {
        target: 'https://simulator.flowindex.io',
        changeOrigin: true,
      },
      '/api/simulate': {
        target: 'https://simulator.flowindex.io',
        changeOrigin: true,
      },
      '/lsp': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/github': {
        target: 'http://localhost:3003',
      },
      '/api/evm-contracts': {
        target: 'http://localhost:3003',
      },
      '/functions': {
        target: 'https://run.flowindex.io',
        changeOrigin: true,
      },
    },
  },
});
