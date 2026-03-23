/**
 * vite.config.js
 *
 * During development, Vite proxies every /api/* request to the
 * Express server (port 3001) so the frontend and backend can run
 * on separate ports without CORS issues in the browser.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Forward all API calls to the Express backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
