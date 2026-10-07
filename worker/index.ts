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

/**
 * Un cliente nuevo por request a propósito: con el singleton compartido entre
 * requests del mismo isolate, varias queries en paralelo (típicas en el load
 * del dashboard) se bloqueaban entre sí y CF terminaba matando al Worker con
 * "code had hung". createClient es un wrapper HTTP liviano, así que armar uno
 * por request no agrega latencia perceptible.
 */
function makeDb(env: Env): Client {
  return createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
    // Evita BigInt en los INTEGER: así rows serializa a JSON sin romper.
    intMode: 'number',
  });
}

/** Rechaza con el error dado si `p` no resuelve antes de `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout de ${label} tras ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Registra un error 5xx del proxy en `app_error_log`. Es best-effort: usa un
 * cliente nuevo y un timeout corto, y nunca propaga su propio fallo (si la
 * base está caída, el logging también lo estaría). La tabla la crea la
 * migración docs/migrations/2026-10-07-app-error-log.sql; si todavía no se
 * aplicó, el INSERT falla silenciosamente y el request original sigue su
 * curso normal.
 */
async function logServerError(
  env: Env,
  source: string,
  status: number,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = makeDb(env);
    await withTimeout(
      db.execute({
        sql: `INSERT INTO app_error_log (id, occurred_at, source, status, message, context)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          new Date().toISOString(),
          source,
          status,
          message.slice(0, 500),
          context ? JSON.stringify(context) : null,
        ],
      }),
      3_000,
      'log',
    );
  } catch {
    /* best-effort: si no se puede loguear, no hacemos ruido */
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook de sincronización desde Google Calendar (vía Apps Script).
    if (url.pathname === '/api/gcal-sync' && request.method === 'POST') {
      try {
        return await handleGcalSync(request, env, makeDb(env));
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
        const db = makeDb(env);
        // Tope defensivo: si Turso cuelga, respondemos 504 nosotros antes de
        // que CF mate al Worker. Un isolate caído envenena otros requests que
        // estén compartiendo el mismo, por eso preferimos abortar explícito.
        const DB_TIMEOUT_MS = 20_000;

        if (Array.isArray(body.batch)) {
          await withTimeout(
            db.batch(
              body.batch.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
              'write',
            ),
            DB_TIMEOUT_MS,
            'batch',
          );
          return Response.json({ ok: true });
        }

        if (typeof body.sql === 'string') {
          const rs = await withTimeout(
            db.execute({ sql: body.sql, args: body.args ?? [] }),
            DB_TIMEOUT_MS,
            'execute',
          );
          return Response.json({ rows: rs.rows, rowsAffected: rs.rowsAffected });
        }

        return Response.json({ error: 'Payload inválido' }, { status: 400 });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const status = message.startsWith('Timeout de ') ? 504 : 400;
        // Solo registramos los fallos de infra (timeouts / errores del driver).
        // Los 400 por payload inválido son ruido y no indican incidente.
        if (status >= 500) {
          // No await: no bloqueamos la respuesta por el logging.
          void logServerError(env, 'worker:api/db', status, message);
        }
        return Response.json({ error: message }, { status });
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
