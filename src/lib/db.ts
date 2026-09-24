import { createClient, type Client, type InValue } from '@libsql/client/web';

/**
 * Cliente libSQL (Turso) para el navegador.
 *
 * ⚠️ SEGURIDAD: en una PWA el token viaja en el bundle. Para producción, mover
 * las escrituras a un backend/proxy o usar tokens de solo lectura. Para el MVP
 * se conecta directo con las variables VITE_TURSO_*.
 */

const url = import.meta.env.VITE_TURSO_DATABASE_URL as string | undefined;
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN as string | undefined;

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    if (!url) {
      throw new Error(
        'Falta VITE_TURSO_DATABASE_URL. Copiá .env.example a .env y completá las credenciales.',
      );
    }
    _client = createClient({ url, authToken });
  }
  return _client;
}

/** Ejecuta una consulta y devuelve las filas tipadas como T. */
export async function query<T>(
  sql: string,
  args: InValue[] = [],
): Promise<T[]> {
  const rs = await getDb().execute({ sql, args });
  return rs.rows as unknown as T[];
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
  const rs = await getDb().execute({ sql, args });
  return rs.rowsAffected;
}

/** Transacción con varias sentencias (batch atómico). */
export async function batch(
  stmts: { sql: string; args?: InValue[] }[],
): Promise<void> {
  await getDb().batch(
    stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    'write',
  );
}
