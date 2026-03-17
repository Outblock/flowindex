import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/functions/v1': {
        target: 'https://flowindex.io',
        changeOrigin: true,
        secure: true,
      },
      '/auth/v1': {
        target: 'https://flowindex.io',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: { outDir: 'dist' },
  resolve: {
    alias: { '@': '/src' },
  },
});
