import type { InValue } from '@libsql/client/web';

/**
 * Acceso a datos del frontend.
 *
 * - Producción: pega al proxy del Worker en POST /api/db. El token de Turso vive
 *   como secret del Worker, NUNCA en el bundle del navegador.
 * - Desarrollo (import.meta.env.DEV): usa un cliente directo a Turso (src/lib/db.dev.ts)
 *   con las VITE_TURSO_* del .env local, para conservar HMR. Ese branch se elimina
 *   del bundle de producción por dead-code elimination.
 *
 * Las firmas query/queryOne/execute/batch se mantienen: los 21 call sites no cambian.
 */

interface DbResult {
  rows?: unknown[];
  rowsAffected?: number;
  ok?: boolean;
  error?: string;
}

async function callApi(payload: unknown): Promise<DbResult> {
  const res = await fetch('/api/db', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as DbResult;
  if (!res.ok) {
    throw new Error(data.error ?? `Error de base de datos (${res.status}).`);
  }
  return data;
}

async function execRaw(
  sql: string,
  args: InValue[],
): Promise<{ rows: unknown[]; rowsAffected: number }> {
  if (import.meta.env.DEV) {
    const { devExecute } = await import('./db.dev');
    return devExecute(sql, args);
  }
  const data = await callApi({ sql, args });
  return { rows: data.rows ?? [], rowsAffected: data.rowsAffected ?? 0 };
}

async function batchRaw(
  stmts: { sql: string; args?: InValue[] }[],
): Promise<void> {
  if (import.meta.env.DEV) {
    const { devBatch } = await import('./db.dev');
    return devBatch(stmts);
  }
  await callApi({ batch: stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })) });
}

/** Ejecuta una consulta y devuelve las filas tipadas como T. */
export async function query<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const { rows } = await execRaw(sql, args);
  return rows as unknown as T[];
}

/** Devuelve la primera fila o null. */
export async function queryOne<T>(
  sql: string,
  args: InValue[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/** Ejecuta una mutación (INSERT/UPDATE/DELETE) y devuelve filas afectadas. */
export async function execute(
  sql: string,
  args: InValue[] = [],
): Promise<number> {
  const { rowsAffected } = await execRaw(sql, args);
  return rowsAffected;
}

/** Transacción con varias sentencias (batch atómico). */
export async function batch(
  stmts: { sql: string; args?: InValue[] }[],
): Promise<void> {
  await batchRaw(stmts);
}
