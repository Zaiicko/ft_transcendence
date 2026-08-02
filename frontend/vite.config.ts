import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Sépare les grosses dépendances stables (React, router, i18n, sockets…)
        // du code applicatif : le navigateur les met en cache à part et ne les
        // re-télécharge pas quand seul notre code change.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router') || id.includes('@remix-run')) return 'router';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/'))
            return 'react';
          if (id.includes('i18next')) return 'i18n';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'socket';
          if (id.includes('gsap')) return 'gsap';
          return 'vendor';
        },
      },
    },
  },
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
