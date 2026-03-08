import { defineConfig } from 'tsup';
import { cpSync } from 'fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  onSuccess: async () => {
    // Copy cadence templates to dist so they're available at runtime
    cpSync('src/templates/cadence', 'dist/templates/cadence', { recursive: true });
  },
});
