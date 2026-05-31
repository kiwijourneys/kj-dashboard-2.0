import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.PORT || '5174', 10),
    host: '127.0.0.1',
    // Disable file watching — project lives on Google Drive FUSE which
    // fires spurious change events for every read, causing an HMR storm.
    // Reload the browser manually after editing files.
    watch: null,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
