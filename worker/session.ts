import type { Client } from '@libsql/client/web';
import { parseCookieToken, verifyToken } from './auth';

interface SessionEnv { SESSION_SECRET?: string; TURSO_AUTH_TOKEN: string }

/** Clave propia si está configurada; fallback con dominio separado para instalaciones existentes. */
export function sessionSigningSecret(env: SessionEnv): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (!env.TURSO_AUTH_TOKEN) throw new Error('Falta configurar la clave de sesión.');
  return `medusa:session:v1:${env.TURSO_AUTH_TOKEN}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface SessionActor {
  id: string;
  organization_id: string;
  full_name: string;
  role: string;
}

export async function requireActor(request: Request, env: SessionEnv, db: Client): Promise<SessionActor> {
  const token = parseCookieToken(request);
  const payload = token ? await verifyToken(token, sessionSigningSecret(env)) : null;
  if (!payload) throw new ApiError(401, 'Tu sesión venció. Volvé a iniciar sesión.');
  const result = await db.execute({
    sql: 'SELECT id, organization_id, full_name, role FROM app_user WHERE id = ? AND organization_id = ? AND active = 1',
    args: [payload.userId, payload.orgId],
  });
  const actor = result.rows[0] as unknown as SessionActor | undefined;
  if (!actor) throw new ApiError(401, 'Usuario inactivo o sesión inválida.');
  return actor;
}
