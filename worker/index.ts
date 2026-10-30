import { actorForAudit, auditedBatch, isReadStatement, readAudit, validateActorWrites, validateAppStatement, withSystemAudit } from './audit';
import { ApiError, requireActor, sessionSigningSecret } from './session';
import { createClient, type Client, type InValue } from '@libsql/client/web';
import { handleGcalSync } from './gcalSync';
import { handleGcal } from './gcal';
import {
  hashPassword,
  verifyPassword,
  signToken,
  sessionCookie,
  clearCookie,
  parseCookieToken,
  verifyToken,
} from './auth';

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
  /** Secreto para firmar tokens de sesión (HMAC-SHA256). */
  SESSION_SECRET: string;
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
  /** Lecturas independientes agrupadas por el cliente (src/lib/db.ts). */
  reads?: { sql: string; args?: InValue[] }[];
}

/** Tope de lecturas por request agrupado; el cliente nunca manda más. */
const MAX_READS = 50;

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

/* ─── Handler de login ────────────────────────────────────────────────────── */

interface LoginBody {
  user_id: string;
  org_id: string;
  branch_id: string;
  password?: string;
}

interface AppUserRow {
  id: string;
  organization_id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: number;
  password_hash: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BranchRow {
  id: string;
  organization_id: string;
  name: string;
  code: string;
}

interface OrgRow {
  id: string;
  name: string;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return Response.json({ error: 'Payload inválido' }, { status: 400 });
  }

  const { user_id, org_id, branch_id, password } = body;
  if (!user_id || !org_id || !branch_id) {
    return Response.json(
      { error: 'Faltan campos requeridos.' },
      { status: 400 },
    );
  }

  const db = makeDb(env);

  // Verificar usuario, organización y sucursal en paralelo.
  const [userRs, branchRs, orgRs] = await Promise.all([
    db.execute({
      sql: `SELECT id, organization_id, username, full_name, email, phone, role,
                   active, password_hash, last_login_at, created_at, updated_at
              FROM app_user
             WHERE id = ? AND organization_id = ? AND active = 1`,
      args: [user_id, org_id],
    }),
    db.execute({
      sql: `SELECT id, organization_id, name, code FROM branch WHERE id = ? AND organization_id = ? AND active = 1`,
      args: [branch_id, org_id],
    }),
    db.execute({
      sql: `SELECT id, name FROM organization WHERE id = ? AND active = 1`,
      args: [org_id],
    }),
  ]);

  const user = userRs.rows[0] as unknown as AppUserRow | undefined;
  const branch = branchRs.rows[0] as unknown as BranchRow | undefined;
  const org = orgRs.rows[0] as unknown as OrgRow | undefined;

  if (!user || !branch || !org) {
    return Response.json(
      { error: 'Usuario, sucursal u organización no válidos.' },
      { status: 401 },
    );
  }

  // Sin una credencial verificada no se puede atribuir autoría de forma fiable.
  if (!user.password_hash) {
    return Response.json({ error: 'Usuario sin token configurado.' }, { status: 401 });
  }
  {
    if (!password) {
      return Response.json(
        { error: 'Se requiere contraseña.' },
        { status: 401 },
      );
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return Response.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
    }
  }

  // Actualizar last_login_at.
  const now = new Date().toISOString();
  await db
    .execute({
      sql: `UPDATE app_user SET last_login_at = ?, updated_at = ? WHERE id = ?`,
      args: [now, now, user.id],
    })
    .catch(() => {
      /* best-effort */
    });

  // Emitir siempre la cookie que identifica al autor de las escrituras.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  {
    const token = await signToken(
      { userId: user.id, orgId: org_id, branchId: branch_id, role: user.role },
      sessionSigningSecret(env),
    );
    const secure = new URL(request.url).protocol === 'https:';
    headers.set('Set-Cookie', sessionCookie(token, secure));
  }

  // No exponer password_hash al cliente.
  const { password_hash: _ph, ...safeUser } = user;
  return new Response(
    JSON.stringify({ user: safeUser, branch, organization: org }),
    { status: 200, headers },
  );
}

/* ─── Utilidad: hashear contraseña desde el panel de admin ───────────────── */
// Expuesta como endpoint interno (requiere token válido) para que Settings
// pueda setear contraseñas a colaboradoras sin exponer la lógica al cliente.

async function handleSetPassword(request: Request, env: Env): Promise<Response> {
  let body: { user_id: string; password: string; org_id?: string } & Record<string, unknown>;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Payload inválido' }, { status: 400 });
  }

  if (!body.user_id || !body.password || String(body.password).length < 4) {
    return Response.json(
      { error: 'user_id y password (mín. 4 chars) requeridos.' },
      { status: 400 },
    );
  }

  const db = makeDb(env);
  const actor = await requireActor(request, env, db);
  if (!['admin', 'manager'].includes(actor.role)) return Response.json({ error: 'Sin permisos' }, { status: 403 });
  const orgId = actor.organization_id;

  const hash = await hashPassword(String(body.password));
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE app_user SET password_hash = ?, updated_at = ? WHERE id = ? AND organization_id = ?`,
    args: [hash, now, body.user_id, orgId],
  });

  return Response.json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Webhook de sincronización desde Google Calendar (vía Apps Script).
    if (url.pathname === '/api/gcal-sync' && request.method === 'POST') {
      try {
        return await handleGcalSync(request, env, withSystemAudit(makeDb(env)));
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

    // ── Autenticación ─────────────────────────────────────────────────────────
    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const secure = url.protocol === 'https:';
      return new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': clearCookie(secure) },
      });
    }

    if (url.pathname === '/api/set-password' && request.method === 'POST') {
      return handleSetPassword(request, env).catch((error: unknown) => Response.json(
        { error: error instanceof Error ? error.message : 'Error de sesión' },
        { status: error instanceof ApiError ? error.status : 500 },
      ));
    }

    // Verifica la sesión y devuelve el payload del token (para que el cliente
    // pueda re-hidratar la sesión en una recarga sin re-loguear).
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const token = parseCookieToken(request);
      if (!token) {
        return Response.json({ user: null }, { status: 200 });
      }
      const payload = await verifyToken(token, sessionSigningSecret(env));
      return Response.json({ user: payload }, { status: 200 });
    }

    if (url.pathname === '/api/audit' && request.method === 'GET') {
      try {
        const db = makeDb(env);
        return await readAudit(url, await requireActor(request, env, db), db);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Error de auditoría' },
          { status: error instanceof ApiError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
      }
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
          body.batch.forEach((statement) => validateAppStatement(statement.sql));
          const actor = await requireActor(request, env, db);
          validateActorWrites(body.batch, actor);
          await withTimeout(
            auditedBatch(db, body.batch.map((s) => ({ sql: s.sql, args: s.args ?? [] })), actorForAudit(actor)),
            DB_TIMEOUT_MS,
            'batch',
          );
          return Response.json({ ok: true });
        }

        // Varias lecturas en un solo request: un único viaje a Turso en vez de
        // uno por query. Si alguna falla, falla el lote entero y el cliente
        // reintenta cada una por separado para aislar el error.
        if (Array.isArray(body.reads)) {
          if (!body.reads.length || body.reads.length > MAX_READS) {
            return Response.json({ error: 'Lote de lecturas inválido' }, { status: 400 });
          }
          for (const statement of body.reads) {
            validateAppStatement(statement.sql);
            if (!isReadStatement(statement.sql)) {
              throw new ApiError(400, 'El lote de lecturas solo admite SELECT.');
            }
          }
          const results = await withTimeout(
            db.batch(body.reads.map((s) => ({ sql: s.sql, args: s.args ?? [] })), 'read'),
            DB_TIMEOUT_MS,
            'reads',
          );
          return Response.json({ results: results.map((rs) => ({ rows: rs.rows })) });
        }

        if (typeof body.sql === 'string') {
          validateAppStatement(body.sql);
          const statement = { sql: body.sql, args: body.args ?? [] };
          const operation = isReadStatement(body.sql)
            ? db.execute(statement)
            : requireActor(request, env, db).then(async (actor) => {
              validateActorWrites([statement], actor);
              return (await auditedBatch(db, [statement], actorForAudit(actor)))[0];
            });
          const rs = await withTimeout(
            operation,
            DB_TIMEOUT_MS,
            'execute',
          );
          return Response.json({ rows: rs.rows, rowsAffected: rs.rowsAffected });
        }

        return Response.json({ error: 'Payload inválido' }, { status: 400 });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const status = e instanceof ApiError ? e.status : message.startsWith('Timeout de ') ? 504 : 400;
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
