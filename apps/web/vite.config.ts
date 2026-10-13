import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Same-origin /api in dev → the Worker; production serves both from one Worker deployment.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
