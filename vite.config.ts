import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { handleGcal, type GcalEnv } from './worker/gcal';

/**
 * En producción POST /api/gcal lo atiende el Worker (worker/index.ts). `vite dev`
 * no corre el Worker, así que replicamos la ruta acá con el MISMO módulo, leyendo
 * GCAL_SA_EMAIL / GCAL_SA_PRIVATE_KEY del .env local. Van sin prefijo VITE_ a
 * propósito: la clave privada nunca debe entrar al bundle del navegador.
 */
function gcalDevApi(env: GcalEnv): Plugin {
  return {
    name: 'medusa-gcal-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/gcal', (req, res, next) => {
        if (req.method !== 'POST') return next();
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          let payload: unknown = null;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // Cuerpo inválido: handleGcal responde el error que corresponda.
          }
          handleGcal(payload, env)
            .then(({ status, body }) => {
              res.statusCode = status;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(body));
            })
            .catch((e: unknown) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(
                JSON.stringify({
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
            });
        });
      });
    },
  };
}

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
    gcalDevApi({
      GCAL_SA_EMAIL: env.GCAL_SA_EMAIL,
      GCAL_SA_PRIVATE_KEY: env.GCAL_SA_PRIVATE_KEY,
    }),
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
  };
});
