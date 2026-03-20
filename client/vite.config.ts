import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawBase = env.VITE_BASE_PATH || '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const basePath = normalizedBase === '/' ? '' : normalizedBase.replace(/\/$/, '');

  return {
    base: normalizedBase,
    plugins: [react()],
    server: {
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true
        },
        '/api': {
          target: 'http://localhost:3001'
        },
        [`${basePath}/socket.io`]: {
          target: 'http://localhost:3001',
          ws: true
        },
        [`${basePath}/api`]: {
          target: 'http://localhost:3001'
        }
      }
    }
  };
});
