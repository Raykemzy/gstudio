import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { aiMiddleware } from './server/ai.mjs';

// The AI endpoint runs inside the Vite dev/preview server so the API key never reaches the browser.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'garment-ai-api',
      configureServer(server) {
        server.middlewares.use(aiMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(aiMiddleware());
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1200 }, // three.js dominates the bundle; fine for a local app
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
