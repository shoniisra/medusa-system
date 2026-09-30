import { batch, query } from '@/lib/db';
import { phoneToWaDigits } from '@/lib/phone';
import { normalizeText } from '@/lib/text';
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

/** Clave por nombre completo: "Ana Pau" == "ana  pau" == first=Ana last=Pau. */
export function nameKey(first: string, last: string | null): string {
  return normalizeText(`${first} ${last ?? ''}`);
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

/** Email normalizado, o '' si no hay. */
function emailKey(email: string | null): string {
  return email ? normalizeText(email) : '';
}

export type ContactField = 'phone' | 'email';

/**
 * Datos de contacto del duplicado que la combinación descarta: los del
 * principal ganan (a diferencia de las notas, que se conservan juntas), así que
 * un teléfono o un email distinto se pierde y hay que avisarlo.
 */
export function discardedContact(keep: Customer, dup: Customer): ContactField[] {
  const out: ContactField[] = [];
  const kp = phoneKey(keep.phone);
  const dp = phoneKey(dup.phone);
  if (kp && dp && kp !== dp) out.push('phone');
  const ke = emailKey(keep.email);
  const de = emailKey(dup.email);
  if (ke && de && ke !== de) out.push('email');
  return out;
}

/**
 * Dato de contacto que se contradice: los dos tienen valor y es distinto.
 * Combinar en ese caso pierde uno, así que el par no se sugiere solo (en un
 * salón, dos "Karen" con números distintos son dos personas) y cuando lo elige
 * la usuaria se le avisa qué se descarta.
 */
export function contactConflict(a: Customer, b: Customer): ContactField | null {
  return discardedContact(a, b)[0] ?? null;
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
 *
 * Ojo: al ser transitivo, una ficha sin teléfono puede unir dos que SÍ tienen
 * números distintos. El grupo sirve para revisar, pero los pares combinables
 * salen de `mergeablePairs`, no de todas las combinaciones del grupo.
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
        if (!contactConflict(list[idxs[i]], list[idxs[j]])) {
          union(idxs[i], idxs[j]);
        }
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
    const e = emailKey(c.email);
    if (e) push(`e:${e}`, i);
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

/**
 * Pares de un grupo que se pueden combinar sin perder datos: se descartan los
 * que tienen teléfono o email contradictorio, porque el grupo es transitivo y
 * puede haber unido a dos personas distintas a través de una ficha sin número.
 */
export function mergeablePairs<T extends Customer>(group: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (!contactConflict(group[i], group[j])) out.push([group[i], group[j]]);
    }
  }
  return out;
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
  if (!y || normalizeText(x).includes(normalizeText(y))) return x;
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
 *
 * Las fichas llegan del listado, que puede tener minutos de antigüedad. Se
 * releen antes de escribir por dos razones: no pisar con datos viejos lo que se
 * editó en otra pestaña, y no reparentar citas y ventas hacia una ficha que
 * mientras tanto dejó de existir (el UPDATE final no afectaría ninguna fila y
 * quedarían huérfanas sin que nadie se enterara).
 */
export async function mergeCustomers(
  keep: Customer,
  dup: Customer,
): Promise<void> {
  if (keep.id === dup.id) {
    throw new Error('No se puede combinar un contacto con él mismo.');
  }

  const [rows, tables] = await Promise.all([
    query<Customer>('SELECT * FROM customer WHERE id IN (?, ?)', [keep.id, dup.id]),
    customerRefTables(),
  ]);
  const keepNow = rows.find((c) => c.id === keep.id);
  const dupNow = rows.find((c) => c.id === dup.id);
  if (!keepNow || !dupNow) {
    throw new Error(
      'Una de las fichas ya no existe. Recargá la lista de clientes e intentá de nuevo.',
    );
  }
  if (keepNow.organization_id !== dupNow.organization_id) {
    throw new Error('Los contactos son de organizaciones distintas.');
  }

  const f = mergedFields(keepNow, dupNow);

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
