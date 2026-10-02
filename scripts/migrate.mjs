#!/usr/bin/env node
/**
 * Aplica un .sql de docs/migrations contra la base de Turso del .env local.
 *
 * El esquema vive en Turso y no hay herramienta de migraciones (docs/BACKLOG.md).
 * Esto es lo mínimo para no tener que pegar SQL a mano en una consola web:
 *
 *   node scripts/migrate.mjs docs/migrations/2026-10-01-customer-alias.sql
 *
 * Parte el archivo por ';' (sin triggers ni cadenas con punto y coma, que es lo
 * que hay) y corre cada sentencia por separado, informando cuál falló. Un
 * `ALTER TABLE ... ADD COLUMN` que choca con una columna que ya existe se
 * reporta como "ya aplicada" en vez de cortar: así el script es reejecutable.
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/migrate.mjs <archivo.sql>');
  process.exit(1);
}

/** Lee el .env sin dependencias: KEY=valor, ignorando comentarios. */
function loadEnv(path = '.env') {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const url = env.VITE_TURSO_DATABASE_URL;
if (!url) {
  console.error('Falta VITE_TURSO_DATABASE_URL en el .env.');
  process.exit(1);
}

const db = createClient({ url, authToken: env.VITE_TURSO_AUTH_TOKEN });

const statements = readFileSync(file, 'utf8')
  .split(';')
  .map((s) =>
    s
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter(Boolean);

let failed = false;
for (const sql of statements) {
  const label = sql.replace(/\s+/g, ' ').slice(0, 70);
  try {
    const rs = await db.execute(sql);
    console.log(`✓ ${label}${rs.rowsAffected ? ` (${rs.rowsAffected} filas)` : ''}`);
    // Un .sql de migración puede traer SELECTs de diagnóstico (duplicados a
    // revisar antes de crear un índice único, por ejemplo): sin imprimirlos el
    // archivo no serviría de nada corrido por acá.
    if (rs.rows?.length) console.table(rs.rows.map((r) => ({ ...r })));
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/duplicate column name/i.test(msg)) {
      console.log(`· ${label} — ya aplicada`);
      continue;
    }
    console.error(`✗ ${label}\n  ${msg}`);
    failed = true;
    break;
  }
}
process.exit(failed ? 1 : 0);
