import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { devApi } from './worker/devApi';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefijo '' → carga también las variables sin VITE_ (secrets solo de dev).
  const env = loadEnv(mode, process.cwd(), '');

  return {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    // Login, sesión y escrituras auditadas usan el Worker también en desarrollo.
    devApi(env),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Medusa Estudio',
        short_name: 'Medusa',
        description: 'Gestión multi-sucursal de salones de belleza',
        theme_color: '#0b0b0d',
        background_color: '#0b0b0d',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Datos de Turso: red primero, cae a caché para lectura offline.
            urlPattern: ({ url }) => url.hostname.endsWith('turso.io'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'turso-data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Separar libs pesadas para que la primera carga del shell no las arrastre.
        manualChunks: {
          'vendor-calendar': ['react-big-calendar'],
          'vendor-datefns': ['date-fns'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  };
});
