#!/usr/bin/env node
/**
 * Limpia las fichas de cliente que creó el parser del título de Google Calendar
 * antes del arreglo: nombres como "Marcela Vera (abono 00)" o "LAIDY ()".
 *
 * Solo toca los casos mecánicos: ficha sucia que tiene UNA sola ficha real con
 * el nombre limpio idéntico. Combina igual que el botón Combinar de la app
 * (src/features/clients/mergeCustomers.ts): mueve todo lo que apunta a la
 * sucia —citas, ventas, pagos, fichas de color, facturas…— a la real y borra la
 * sucia. Las tablas se descubren leyendo el DDL, para no dejar referencias
 * colgadas si mañana hay una tabla nueva con customer_id.
 *
 * Los casos ambiguos (sin gemela, o con más de una) se reportan y NO se tocan:
 * decidir ahí es del salón, se combinan desde la pantalla de Clientes.
 *
 *   node scripts/limpiar-clientes-gcal.mjs           # dry-run, no escribe nada
 *   node scripts/limpiar-clientes-gcal.mjs --apply   # ejecuta
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

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
const db = createClient({
  url: env.VITE_TURSO_DATABASE_URL,
  authToken: env.VITE_TURSO_AUTH_TOKEN,
});

/**
 * Palabras de servicio que el parser viejo dejaba pegadas al principio del
 * nombre, porque el título del evento empieza por el servicio ("Cortes Milton
 * Guerrero"). Son las mismas de STOPWORDS en worker/gcalSync.ts.
 */
const PREFIJOS = new Set([
  'cortes', 'corte', 'maquillajes', 'maquillaje', 'tratamientos', 'tratamiento',
  'cabello', 'peinados', 'peinado', 'alisado', 'color', 'coloracion', 'uñas',
  'unas', 'manicura', 'pedicura', 'cejas', 'pestañas', 'pestanas', 'retoque',
  'retiro', 'esmaltado', 'lifting', 'semi', 'semipermanente', 's',
]);

const sinAcentos = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Nombre completo sin la basura que dejaba el parser. */
const clean = (name) => {
  const base = name
    .replace(/\(\s*abono[^)]*\)/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Se van los prefijos de servicio, pero nunca el último token: "Cortes" solo
  // no se convierte en nombre vacío.
  const tok = base.split(' ');
  while (tok.length > 1 && PREFIJOS.has(sinAcentos(tok[0]).toLowerCase()))
    tok.shift();
  return tok.join(' ');
};

/** Tablas reales con columna customer_id (mismo criterio que mergeCustomers). */
const refTables = async () => {
  const rs = await db.execute(
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name <> 'customer' AND sql LIKE '%customer_id%'
      ORDER BY name`,
  );
  return rs.rows
    .filter((r) => r.sql && /\bcustomer_id\b/i.test(r.sql))
    .map((r) => r.name)
    .filter((t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && !t.startsWith('sqlite_'));
};

const SUCIAS = `notes LIKE '%Auto-sync%'
                AND (first_name LIKE '%(abono%' OR first_name LIKE '%()%')`;

const tables = await refTables();
console.log(`Tablas con customer_id: ${tables.join(', ')}\n`);

const sucias = await db.execute(
  `SELECT id, organization_id, TRIM(first_name || ' ' || COALESCE(last_name, '')) AS nom
     FROM customer WHERE ${SUCIAS} ORDER BY created_at DESC`,
);

const pendientes = [];
let hechas = 0;

for (const s of sucias.rows) {
  const limpio = clean(s.nom);
  const gemelas = await db.execute({
    sql: `SELECT id, TRIM(first_name || ' ' || COALESCE(last_name, '')) AS nom, phone
            FROM customer
           WHERE organization_id = ? AND id <> ?
             AND lower(TRIM(first_name || ' ' || COALESCE(last_name, ''))) = lower(?)
             AND first_name NOT LIKE '%(abono%' AND first_name NOT LIKE '%()%'`,
    args: [s.organization_id, s.id, limpio],
  });

  if (gemelas.rows.length !== 1) {
    pendientes.push({ sucia: s.nom, limpio, candidatas: gemelas.rows.length });
    continue;
  }
  const real = gemelas.rows[0];

  // Qué se mueve, para que el dry-run diga algo útil.
  const movidos = [];
  for (const t of tables) {
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM ${t} WHERE customer_id = ?`,
      args: [s.id],
    });
    if (rs.rows[0].n > 0) movidos.push(`${rs.rows[0].n} en ${t}`);
  }

  console.log(
    `${APPLY ? '✓' : '·'} "${s.nom}" → "${real.nom}" [${real.id.slice(0, 8)}] ` +
      `${movidos.length ? `(mueve ${movidos.join(', ')})` : '(nada que mover)'}`,
  );

  if (APPLY) {
    await db.batch(
      [
        ...tables.map((t) => ({
          sql: `UPDATE ${t} SET customer_id = ? WHERE customer_id = ?`,
          args: [real.id, s.id],
        })),
        { sql: 'DELETE FROM customer WHERE id = ?', args: [s.id] },
      ],
      'write',
    );
  }
  hechas++;
}

console.log(
  `\n${APPLY ? 'Combinadas' : 'Se combinarían'}: ${hechas} de ${sucias.rows.length}`,
);
if (pendientes.length) {
  console.log('\nA mano, desde Clientes (ambiguas):');
  for (const p of pendientes)
    console.log(
      `  · "${p.sucia}" → "${p.limpio}": ${p.candidatas} fichas con ese nombre exacto`,
    );
}
if (!APPLY) console.log('\nDry-run: no se escribió nada. Repetir con --apply.');
