import type { Client, InStatement, ResultSet } from '@libsql/client/web';
import { ApiError, type SessionActor } from './session';

export interface AuditActor {
  id: string | null;
  name: string;
  role: string | null;
  orgId: string | null;
  source: 'app' | 'google-calendar';
}

export function actorForAudit(actor: SessionActor): AuditActor {
  return { id: actor.id, name: actor.full_name, role: actor.role, orgId: actor.organization_id, source: 'app' };
}

export function validateActorWrites(statements: { sql: string }[], actor: SessionActor): void {
  // El proxy SQL no debe permitir que una colaboradora se convierta en gerente
  // y obtenga acceso al historial. Administración conserva la gestión de usuarios.
  for (const statement of statements) {
    if (actor.role === 'admin' || !/\bapp_user\b/i.test(statement.sql) || isReadStatement(statement.sql)) continue;
    const profile = /^\s*UPDATE\s+app_user\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\?\s*;?\s*$/i.exec(statement.sql);
    if (actor.role === 'manager' && profile && profile[1].split(',').every((assignment) =>
      /^\s*(phone|email|birth_date|updated_at)\s*=\s*\?\s*$/i.test(assignment))) continue;
    throw new ApiError(403, 'Solo administración puede modificar permisos y credenciales de usuarios.');
  }
}

/** Clasifica una sentencia; los comentarios y literales no alteran la clasificación. */
export function isReadStatement(sql: string): boolean {
  const code = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\/\*[\s\S]*?\*\/|--[^\n]*/g,
    (token) => token.startsWith('--') || token.startsWith('/*') ? ' ' : token.startsWith("'") ? "''" : token,
  ).trim();
  return /^SELECT\b/i.test(code) || (/^WITH\b/i.test(code) && !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(code));
}

/** El proxy de aplicación no puede leer/escribir auditoría ni cambiar el esquema/triggers. */
export function validateAppStatement(sql: string): void {
  const code = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\/\*[\s\S]*?\*\/|--[^\n]*/g,
    (token) => token.startsWith('--') || token.startsWith('/*') ? ' ' : token.startsWith("'") ? "''" : token,
  ).trim().replace(/;\s*$/, '');
  if (/\b(?:app_)?audit_(log|context)\b/i.test(sql) || code.includes(';') ||
      !/^(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(code) || /\b(?:OR\s+REPLACE|REPLACE\s+INTO)\b/i.test(code)) {
    throw new ApiError(403, 'Sentencia no permitida por el proxy de aplicación.');
  }
}

/** El contexto, el cambio y el historial se confirman o revierten juntos. */
export async function auditedBatch(db: Client, statements: InStatement[], actor: AuditActor): Promise<ResultSet[]> {
  if (!statements.length) return [];
  const result = await db.batch([
    { sql: `INSERT INTO app_audit_context (id, request_id, actor_id, actor_name, actor_role, organization_id, source)
            VALUES (1, ?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), actor.id, actor.name, actor.role, actor.orgId, actor.source] },
    ...statements,
    { sql: 'DELETE FROM app_audit_context WHERE id = 1', args: [] },
  ], 'write');
  return result.slice(1, -1);
}

/** Envuelve también las escrituras de la sincronización, que no tiene un usuario humano. */
export function withSystemAudit(db: Client): Client {
  const actor: AuditActor = { id: null, name: 'Google Calendar', role: null, orgId: null, source: 'google-calendar' };
  return new Proxy(db, {
    get(target, key) {
      if (key === 'execute') return async (statement: InStatement) => {
        const sql = typeof statement === 'string' ? statement : statement.sql;
        return isReadStatement(sql) ? target.execute(statement) : (await auditedBatch(target, [statement], actor))[0];
      };
      if (key === 'batch') return (statements: InStatement[]) => auditedBatch(target, statements, actor);
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
}

/** Endpoint de solo lectura: organización y rol proceden de la sesión verificada. */
export async function readAudit(url: URL, actor: SessionActor, db: Client): Promise<Response> {
  if (!['admin', 'manager'].includes(actor.role)) throw new ApiError(403, 'Sin permiso para consultar auditoría.');
  const params = url.searchParams;
  const where = ['organization_id = ?'];
  const args: (string | number)[] = [actor.organization_id];
  for (const field of ['entity_type', 'entity_id', 'actor_id', 'action', 'branch_id']) {
    const value = params.get(field);
    if (value) { where.push(`${field} = ?`); args.push(value); }
  }
  for (const [param, operator] of [['from', '>='], ['to', '<']] as const) {
    const value = params.get(param);
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value) throw new ApiError(400, 'Fecha inválida.');
      where.push(`occurred_at ${operator} ?`);
      // Los filtros son días de Ecuador; fin exclusivo del día siguiente.
      const timestamp = new Date(`${value}T00:00:00-05:00`).getTime() + (param === 'to' ? 86_400_000 : 0);
      args.push(new Date(timestamp).toISOString());
    }
  }
  const cursor = params.get('before');
  if (cursor) {
    if (!/^\d+$/.test(cursor)) throw new ApiError(400, 'Página inválida.');
    where.push('id < ?'); args.push(cursor);
  }
  const [rows, actors] = await Promise.all([
    db.execute({ sql: `SELECT * FROM app_audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 51`, args }),
    db.execute({ sql: `SELECT DISTINCT actor_id, actor_name FROM app_audit_log WHERE organization_id = ? ORDER BY actor_name`, args: [actor.organization_id] }),
  ]);
  return Response.json({ rows: rows.rows.slice(0, 50), next: rows.rows.length > 50 ? rows.rows[49].id : null, actors: actors.rows },
    { headers: { 'Cache-Control': 'no-store' } });
}
