import { createClient, type Client, type InValue } from '@libsql/client/web';

/**
 * SOLO DESARROLLO. Conexión directa a Turso con las VITE_TURSO_* del .env local,
 * para conservar HMR sin levantar el Worker. db.ts importa este módulo de forma
 * dinámica dentro de `if (import.meta.env.DEV)`, así Vite lo elimina por
 * dead-code del bundle de producción: el token nunca llega al navegador en prod.
 */

let _client: Client | null = null;
function getDb(): Client {
  if (!_client) {
    const url = import.meta.env.VITE_TURSO_DATABASE_URL as string | undefined;
    const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN as string | undefined;
    if (!url) {
      throw new Error(
        'Falta VITE_TURSO_DATABASE_URL en el .env local (modo dev).',
      );
    }
    _client = createClient({ url, authToken });
  }
  return _client;
}

export async function devExecute(
  sql: string,
  args: InValue[],
): Promise<{ rows: unknown[]; rowsAffected: number }> {
  const rs = await getDb().execute({ sql, args });
  return { rows: rs.rows as unknown[], rowsAffected: rs.rowsAffected };
}

export async function devBatch(
  stmts: { sql: string; args?: InValue[] }[],
): Promise<void> {
  await getDb().batch(
    stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    'write',
  );
}
