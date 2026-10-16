import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      proxy: { '/api': {
        target: environment.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        // The admin API verifies its public origin, including the development port.
        changeOrigin: false,
      } },
    },
  };
});
