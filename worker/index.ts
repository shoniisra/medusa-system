import { createClient, type Client, type InValue } from '@libsql/client/web';

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
    return env.ASSETS.fetch(request);
  },
};
