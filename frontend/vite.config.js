// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react({
        // Fast Refresh for instant HMR without losing component state
        fastRefresh: true,
      }),
    ],

    resolve: {
      alias: {
        // Absolute imports: import { foo } from '@/components/...'
        '@': path.resolve(__dirname, './src'),
      },
    },

    // ── Dev server ──────────────────────────────────────────────────────────
    server: {
      port:        5173,
      strictPort:  true,
      host:        true,       // expose on 0.0.0.0 (needed inside Docker)

      proxy: {
        // Proxy API calls to avoid CORS in development
        '/api': {
          target:      env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
          secure:      false,
        },
        // Proxy WebSocket connections
        '/socket.io': {
          target:      env.VITE_WS_URL || 'http://localhost:3000',
          changeOrigin: true,
          ws:          true,    // ← enable WebSocket proxying
        },
      },
    },

    // ── Build ───────────────────────────────────────────────────────────────
    build: {
      outDir:           'dist',
      sourcemap:        mode !== 'production',
      chunkSizeWarningLimit: 600,

      rollupOptions: {
        output: {
          // Split large deps into separate chunks for better caching
          manualChunks: {
            'react-vendor':   ['react', 'react-dom', 'react-router-dom'],
            'redux-vendor':   ['@reduxjs/toolkit', 'react-redux'],
            'charts-vendor':  ['recharts'],
            'motion-vendor':  ['framer-motion'],
            'socket-vendor':  ['socket.io-client'],
          },
        },
      },
    },

    // ── Environment variables exposed to the browser ─────────────────────────
    // Only vars prefixed VITE_ are exposed — prevents leaking secrets
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
  };
});
