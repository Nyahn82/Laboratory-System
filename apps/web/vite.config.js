import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = (target, prefix) => ({
  target,
  changeOrigin: true,
  rewrite: (path) => path.replace(prefix, ''),
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': proxy(process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:3001', /^\/api\/auth/),
      '/api/records': proxy(process.env.RECORDS_SERVICE_URL || 'http://127.0.0.1:3002', /^\/api\/records/),
      '/api/storage': proxy(process.env.STORAGE_SERVICE_URL || 'http://127.0.0.1:3003', /^\/api\/storage/),
      '/api/verification': proxy(process.env.VERIFICATION_SERVICE_URL || 'http://127.0.0.1:3004', /^\/api\/verification/),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
});

