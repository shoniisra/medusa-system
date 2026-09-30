import { createClient, type Client, type InValue } from '@libsql/client/web';
import { handleGcalSync } from './gcalSync';
import { handleGcal } from './gcal';

/**
 * Worker de Cloudflare: sirve los assets estáticos de la SPA y expone un proxy
 * SQL en POST /api/db. Las credenciales de Turso viven acá como secrets del
 * Worker (TURSO_*), nunca en el bundle del navegador.
 *
 * El host completo está detrás de Cloudflare Access (allowlist por correo), así
 * que /api/db solo es alcanzable por usuarios autenticados.
 */

interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  /** Secreto compartido con el Apps Script que sincroniza Google Calendar. */
  GCAL_SYNC_SECRET: string;
  /** Service account que escribe en los calendarios (sistema → Google). */
  GCAL_SA_EMAIL?: string;
  GCAL_SA_PRIVATE_KEY?: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

interface DbPayload {
  sql?: string;
  args?: InValue[];
  batch?: { sql: string; args?: InValue[] }[];
}

let _client: Client | null = null;
function getDb(env: Env): Client {
  if (!_client) {
    _client = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
      // Evita BigInt en los INTEGER: así rows serializa a JSON sin romper.
      intMode: 'number',
    });
  }
  return _client;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook de sincronización desde Google Calendar (vía Apps Script).
    if (url.pathname === '/api/gcal-sync' && request.method === 'POST') {
      try {
        return await handleGcalSync(request, env, getDb(env));
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 400 },
        );
      }
    }

    // Escritura/lectura de Google Calendar con la service account. Corre acá
    // para que nadie tenga que iniciar sesión en Google desde el navegador.
    if (url.pathname === '/api/gcal' && request.method === 'POST') {
      const payload = await request.json().catch(() => null);
      const { status, body } = await handleGcal(payload, env);
      return Response.json(body, { status });
    }

    if (url.pathname === '/api/db' && request.method === 'POST') {
      try {
        const body = (await request.json()) as DbPayload;
        const db = getDb(env);

        if (Array.isArray(body.batch)) {
          await db.batch(
            body.batch.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
            'write',
          );
          return Response.json({ ok: true });
        }

        if (typeof body.sql === 'string') {
          const rs = await db.execute({ sql: body.sql, args: body.args ?? [] });
          return Response.json({ rows: rs.rows, rowsAffected: rs.rowsAffected });
        }

        return Response.json({ error: 'Payload inválido' }, { status: 400 });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 400 },
        );
      }
    }

    // Cualquier otra ruta → assets estáticos (con fallback SPA).
    const assetRes = await env.ASSETS.fetch(request);

    // Los chunks con hash de un build viejo ya no existen tras el deploy y el
    // fallback SPA les contestaría index.html con content-type de HTML: el
    // import dinámico del navegador falla con un error confuso y encima
    // cacheable. Para /assets/* devolvemos un 404 limpio.
    if (
      url.pathname.startsWith('/assets/') &&
      assetRes.headers.get('content-type')?.includes('text/html')
    ) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }

    return assetRes;
  },
};
