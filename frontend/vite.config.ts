import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // HMR websocket goes through the nginx HTTPS proxy
    hmr: {
      protocol: 'wss',
      clientPort: 8443,
    },
  },
});
