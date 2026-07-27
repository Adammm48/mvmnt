import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the shared package straight from source: it is internal, so
      // there is no build step to keep in sync.
      '@mvmnt/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: { port: 5173 },
});
