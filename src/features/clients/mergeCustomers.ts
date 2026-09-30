import { batch, query } from '@/lib/db';
import { phoneToWaDigits } from '@/lib/phone';
import type { Customer, ID } from '@/types';

/**
 * Combinar contactos duplicados.
 *
 * El mismo cliente suele entrar dos veces: una al reservar desde la agenda y
 * otra al importar la libreta de contactos. Combinar mueve TODO lo que apunta
 * al duplicado (citas, ventas, fichas de color, facturas…) al contacto
 * principal, completa los campos vacíos con los del duplicado y borra la fila
 * sobrante. Todo en un batch atómico: o se hace completo o no se hace.
 */

/** Solo nombres de tabla simples: se interpolan en el SQL. */
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Etiquetas en español para el resumen de lo que se va a mover. */
const TABLE_LABELS: Record<string, [string, string]> = {
  appointment: ['cita', 'citas'],
  sale: ['venta', 'ventas'],
  customer_color_record: ['ficha de color', 'fichas de color'],
  invoice_request: ['solicitud de factura', 'solicitudes de factura'],
  invoice: ['factura', 'facturas'],
  payment: ['pago', 'pagos'],
};

export function tableLabel(table: string, count: number): string {
  const pair = TABLE_LABELS[table];
  if (!pair) return `${count} en ${table}`;
  return `${count} ${count === 1 ? pair[0] : pair[1]}`;
}

/**
 * Tablas reales (no vistas) con columna `customer_id`. Se descubren leyendo el
 * DDL de la propia DB para que el combinado no se quede corto si mañana se
 * agrega otra tabla que apunte al cliente.
 */
export async function customerRefTables(): Promise<string[]> {
  const rows = await query<{ name: string; sql: string | null }>(
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name <> 'customer'
        AND sql LIKE '%customer_id%'
      ORDER BY name`,
  );
  // \b evita falsos positivos tipo `old_customer_id`.
  const hasCol = /\bcustomer_id\b/i;
  return rows
    .filter((r) => !!r.sql && hasCol.test(r.sql))
    .map((r) => r.name)
    .filter((t) => SAFE_TABLE.test(t) && !t.startsWith('sqlite_'));
}

export interface RefCount {
  table: string;
  count: number;
}

/** Cuántas filas de cada tabla se moverían al combinar este contacto. */
export async function customerRefCounts(customerId: ID): Promise<RefCount[]> {
  const tables = await customerRefTables();
  if (tables.length === 0) return [];
  const sql = tables
    .map((t) => `SELECT '${t}' AS tbl, COUNT(*) AS n FROM ${t} WHERE customer_id = ?`)
    .join(' UNION ALL ');
  const rows = await query<{ tbl: string; n: number }>(
    sql,
    tables.map(() => customerId),
  );
  return rows
    .map((r) => ({ table: r.tbl, count: Number(r.n) }))
    .filter((r) => r.count > 0);
}

/* ───────────────────────── Detección de duplicados ───────────────────────── */

/** Normaliza texto: sin acentos, minúsculas, espacios colapsados. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave por nombre completo: "Ana Pau" == "ana  pau" == first=Ana last=Pau. */
export function nameKey(first: string, last: string | null): string {
  return norm(`${first ?? ''} ${last ?? ''}`);
}

/**
 * Clave por teléfono: se normaliza al canónico y se toman los últimos 9
 * dígitos, así 0991234567, +593991234567 y 593 99 123 4567 (registros viejos
 * sin normalizar) caen en el mismo grupo.
 */
export function phoneKey(phone: string | null): string {
  const d = phoneToWaDigits(phone);
  return d.length >= 7 ? d.slice(-9) : '';
}

/** Nombre de pila normalizado (primera palabra del nombre completo). */
function firstToken(c: Customer): string {
  return nameKey(c.first_name, c.last_name).split(' ')[0] ?? '';
}

/**
 * ¿Los nombres son compatibles? Mismo nombre completo, uno prefijo del otro
 * ("Ana Pau" / "Ana Paula Vera") o mismo nombre de pila. Se exige esto para
 * los pares que solo coinciden en teléfono o email: en un salón es normal que
 * madre e hija compartan el mismo WhatsApp y no son la misma persona.
 */
function namesRelated(a: Customer, b: Customer): boolean {
  const ka = nameKey(a.first_name, a.last_name);
  const kb = nameKey(b.first_name, b.last_name);
  if (!ka || !kb) return false;
  if (ka === kb || ka.startsWith(kb) || kb.startsWith(ka)) return true;
  const fa = firstToken(a);
  return !!fa && fa === firstToken(b);
}

/**
 * Agrupa contactos que parecen la misma persona: mismo nombre completo con
 * teléfonos que no se contradicen (al menos uno sin número, o el mismo), o
 * mismo teléfono / email con nombres compatibles. Transitivo (A~B y B~C ⇒ un
 * solo grupo). Devuelve solo los grupos de 2 o más, con la ficha más completa
 * primero (la sugerida como principal).
 */
export function duplicateGroups<T extends Customer>(list: T[]): T[][] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Mismo nombre completo, y teléfonos que no se contradicen. Dos "karen" con
  // números distintos son personas distintas: nunca se fusiona solo por nombre.
  const byName = new Map<string, number[]>();
  list.forEach((c, i) => {
    const k = nameKey(c.first_name, c.last_name);
    if (!k) return;
    const b = byName.get(k);
    if (b) b.push(i);
    else byName.set(k, [i]);
  });
  for (const idxs of byName.values()) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const x = list[idxs[i]];
        const y = list[idxs[j]];
        const px = phoneKey(x.phone);
        const py = phoneKey(y.phone);
        if (!px || !py || px === py) union(idxs[i], idxs[j]);
      }
    }
  }

  // Mismo teléfono o email: solo si además los nombres son compatibles.
  const buckets = new Map<string, number[]>();
  const push = (k: string, i: number) => {
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  };
  list.forEach((c, i) => {
    const p = phoneKey(c.phone);
    if (p) push(`p:${p}`, i);
    if (c.email) push(`e:${norm(c.email)}`, i);
  });
  for (const idxs of buckets.values()) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        if (namesRelated(list[idxs[i]], list[idxs[j]])) union(idxs[i], idxs[j]);
      }
    }
  }

  const groups = new Map<number, T[]>();
  list.forEach((c, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(c);
    else groups.set(root, [c]);
  });

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((x, y) => completeness(y) - completeness(x)));
}

/** Qué tan completa está una ficha: se sugiere como principal la más completa. */
export function completeness(c: Customer): number {
  const fields = [
    c.phone,
    c.email,
    c.birth_date,
    c.notes,
    c.allergies,
    c.hair_notes,
    c.preferred_staff_id,
    c.last_name,
  ];
  return fields.filter((v) => !!v && String(v).trim() !== '').length;
}

/* ──────────────────────────── Combinación ──────────────────────────── */

/** Texto del principal; si el duplicado aporta algo distinto, se conserva abajo. */
function joinText(a: string | null, b: string | null): string | null {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x) return y || null;
  if (!y || norm(x).includes(norm(y))) return x;
  return `${x}\n${y}`;
}

const firstOf = <T,>(a: T | null, b: T | null): T | null =>
  a !== null && a !== undefined && String(a).trim() !== '' ? a : (b ?? null);

const minDate = (a: string | null, b: string | null) =>
  a && b ? (a < b ? a : b) : (a ?? b ?? null);
const maxDate = (a: string | null, b: string | null) =>
  a && b ? (a > b ? a : b) : (a ?? b ?? null);

/** Campos resultantes: gana el principal, el duplicado rellena los huecos. */
export function mergedFields(keep: Customer, dup: Customer) {
  return {
    first_name: keep.first_name?.trim() || dup.first_name,
    last_name: firstOf(keep.last_name, dup.last_name),
    phone: firstOf(keep.phone, dup.phone),
    email: firstOf(keep.email, dup.email),
    birth_date: firstOf(keep.birth_date, dup.birth_date),
    preferred_staff_id: firstOf(keep.preferred_staff_id, dup.preferred_staff_id),
    notes: joinText(keep.notes, dup.notes),
    allergies: joinText(keep.allergies, dup.allergies),
    hair_notes: joinText(keep.hair_notes, dup.hair_notes),
    first_visit_at: minDate(keep.first_visit_at, dup.first_visit_at),
    last_visit_at: maxDate(keep.last_visit_at, dup.last_visit_at),
  };
}

/**
 * Mueve todo lo del duplicado al principal, fusiona los campos y borra el
 * duplicado. Atómico.
 */
export async function mergeCustomers(
  keep: Customer,
  dup: Customer,
): Promise<void> {
  if (keep.id === dup.id) {
    throw new Error('No se puede combinar un contacto con él mismo.');
  }
  if (keep.organization_id !== dup.organization_id) {
    throw new Error('Los contactos son de organizaciones distintas.');
  }

  const tables = await customerRefTables();
  const f = mergedFields(keep, dup);

  // Orden importante: primero se mueven las referencias, después se borra el
  // duplicado y SOLO entonces se escriben los campos fusionados. Si el
  // principal hereda el teléfono del duplicado, hacerlo antes chocaría con el
  // índice único (organization_id, phone).
  await batch([
    ...tables.map((t) => ({
      sql: `UPDATE ${t} SET customer_id = ? WHERE customer_id = ?`,
      args: [keep.id, dup.id],
    })),
    { sql: 'DELETE FROM customer WHERE id = ?', args: [dup.id] },
    {
      sql: `UPDATE customer SET
              first_name = ?, last_name = ?, phone = ?, email = ?,
              birth_date = ?, preferred_staff_id = ?, notes = ?,
              allergies = ?, hair_notes = ?, first_visit_at = ?,
              last_visit_at = ?, active = 1, updated_at = ?
            WHERE id = ?`,
      args: [
        f.first_name,
        f.last_name,
        f.phone,
        f.email,
        f.birth_date,
        f.preferred_staff_id,
        f.notes,
        f.allergies,
        f.hair_notes,
        f.first_visit_at,
        f.last_visit_at,
        new Date().toISOString(),
        keep.id,
      ],
    },
  ]);
}
