import type { Plugin } from 'vite';
import worker from './index';

/** Expone las APIs necesarias en Vite usando los mismos handlers de producción. */
export function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'medusa-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const method = ['/api/audit', '/api/session'].includes(pathname) ? 'GET' : 'POST';
        if (req.method !== method || !['/api/gcal', '/api/set-password', '/api/login', '/api/logout', '/api/db', '/api/audit', '/api/session'].includes(pathname)) {
          return next();
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const request = new Request(`http://localhost${req.url}`, {
            method,
            headers: { 'content-type': 'application/json', cookie: req.headers.cookie ?? '' },
            body: method === 'POST' ? Buffer.concat(chunks).toString('utf8') : undefined,
          });
          void worker.fetch(request, {
            // Usar la misma base que el cliente de desarrollo (src/lib/db.dev.ts).
            TURSO_DATABASE_URL: env.VITE_TURSO_DATABASE_URL,
            TURSO_AUTH_TOKEN: env.VITE_TURSO_AUTH_TOKEN,
            SESSION_SECRET: env.SESSION_SECRET ?? '',
            GCAL_SYNC_SECRET: '',
            GCAL_SA_EMAIL: env.GCAL_SA_EMAIL,
            GCAL_SA_PRIVATE_KEY: env.GCAL_SA_PRIVATE_KEY,
            ASSETS: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) },
          }).then(async (response) => {
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(await response.text());
          }).catch((error: unknown) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          });
        });
      });
    },
  };
}
