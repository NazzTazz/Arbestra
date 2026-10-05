import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    build:{rollupOptions:{input:{main:'index.html',workshop:'factory-preview.html'}}},
    server: {
      proxy: { '/api': environment.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000' },
    },
  };
});
