import { batch, query, type Stmt } from '@/lib/db';
import { phoneDedupKey } from '@/lib/phone';
import { fullName } from '@/lib/format';
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
async function customerRefTables(): Promise<string[]> {
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
function nameKey(first: string, last: string | null): string {
  return normalizeText(`${first} ${last ?? ''}`);
}

/** Email normalizado, o '' si no hay. */
function emailKey(email: string | null): string {
  return email ? normalizeText(email) : '';
}

/**
 * Todos los nombres por los que se puede reconocer a este contacto: el real,
 * el alias y cada entrada del nombre de la agenda (puede traer varias unidas
 * con " / " si ya se combinó antes). Hace falta para encontrarle la pareja a
 * un contacto sin WhatsApp: ese suele entrar dos veces, una vez con el nombre
 * real (y WhatsApp) desde la agenda del teléfono, y otra con el alias o un
 * apodo ("Mica", "Karen uñas") desde una cita reservada a mano.
 */
function identityKeys(c: Customer): string[] {
  const keys = new Set<string>();
  const full = nameKey(c.first_name, c.last_name);
  if (full) keys.add(full);
  if (c.nickname) {
    const k = normalizeText(c.nickname);
    if (k) keys.add(k);
  }
  if (c.imported_name) {
    for (const part of c.imported_name.split('/')) {
      const k = normalizeText(part);
      if (k) keys.add(k);
    }
  }
  return [...keys];
}

export type ContactField = 'phone' | 'email';

/**
 * Datos de contacto del duplicado que la combinación descarta: los del
 * principal ganan (a diferencia de las notas, que se conservan juntas), así que
 * un teléfono o un email distinto se pierde y hay que avisarlo.
 */
export function discardedContact(keep: Customer, dup: Customer): ContactField[] {
  const out: ContactField[] = [];
  const kp = phoneDedupKey(keep.phone);
  const dp = phoneDedupKey(dup.phone);
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
function contactConflict(a: Customer, b: Customer): ContactField | null {
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
 * Agrupa contactos que parecen la misma persona: mismo nombre real, alias o
 * nombre de agenda (cruzados entre sí) con teléfonos que no se contradicen (al
 * menos uno sin número, o el mismo), o mismo teléfono / email con nombres
 * compatibles. Esto es lo que encuentra la pareja de un contacto sin WhatsApp:
 * su alias o su nombre de agenda suele coincidir con el nombre real de la
 * ficha que sí tiene número. Transitivo (A~B y B~C ⇒ un solo grupo). Devuelve
 * solo los grupos de 2 o más, con la ficha más completa primero (la sugerida
 * como principal).
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

  // Mismo nombre, alias o nombre de agenda (en cualquier combinación), y
  // teléfonos que no se contradicen. Dos "karen" con números distintos son
  // personas distintas: `contactConflict` las separa aunque coincida el nombre.
  const byName = new Map<string, number[]>();
  list.forEach((c, i) => {
    for (const k of identityKeys(c)) {
      const b = byName.get(k);
      if (b) b.push(i);
      else byName.set(k, [i]);
    }
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
    const p = phoneDedupKey(c.phone);
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

/* ─────────── Candidatos para contactos sin WhatsApp ─────────── */

/**
 * Primer nombre que en realidad es una relación o una nota de servicio
 * pegada al nombre al reservar ("Hija Adri", "Magdy uñas", "Limpieza casa").
 * Adivinar la identidad por esa palabra matchea cualquier nota parecida, no a
 * la persona: hay que descartarla antes de buscar candidato.
 */
const NAME_STOPWORDS = new Set([
  'de',
  'la',
  'el',
  'los',
  'las',
  'y',
  'x',
  'a',
  'ya',
  'no',
  'da',
  'aun',
  'hija',
  'hijo',
  'hermana',
  'hermano',
  'mama',
  'mami',
  'papa',
  'papi',
  'tia',
  'tio',
  'prima',
  'primo',
  'sobrina',
  'sobrino',
  'abuela',
  'abuelo',
  'nieta',
  'nieto',
  'esposa',
  'esposo',
  'novia',
  'novio',
  'amiga',
  'amigo',
  'vecina',
  'vecino',
  'cunada',
  'cunado',
  'comadre',
  'sra',
  'srta',
  'sr',
  'clienta',
  'cliente',
  'limpieza',
  'unas',
  'cabello',
  'color',
  'balayage',
]);

/**
 * Primer nombre normalizado, o `''` si no sirve para adivinar con quién
 * combinar: muy corto, una palabra de la lista de arriba, o el campo es en
 * realidad una nota larga ("de x 3 familiares Magdy 2 mujeres y hombre") y no
 * un nombre.
 */
function guessableFirstToken(c: Customer): string {
  const words = nameKey(c.first_name, c.last_name).split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 4) return '';
  const first = words[0];
  if (first.length < 3 || NAME_STOPWORDS.has(first)) return '';
  return first;
}

export interface PhonelessCandidate<T extends Customer> {
  noPhone: T;
  candidate: T;
}

/**
 * Para cada contacto sin WhatsApp, el único contacto CON WhatsApp que
 * comparte su primer nombre.
 *
 * Es la otra mitad de los duplicados: el cliente que reserva una cita a mano
 * sin pasar por "Nuevo cliente" suele quedar con nota tipo "Magdy uñas" o
 * "Iraide salazar corrección" en vez del nombre real, y esa ficha nunca
 * coincide por nombre completo ni comparte teléfono/email con la que sí tiene
 * WhatsApp — `duplicateGroups` no la encuentra. Esto es un indicio por
 * nombre de pila nomás, así que es mucho menos seguro: si hay más de un
 * contacto con ese mismo primer nombre, es ambiguo y no se sugiere nada (dos
 * "Karen" con WhatsApp distinto siguen siendo dos personas). Vive separado de
 * `duplicateGroups` para no bajarle la confianza a esos matches.
 */
export function phonelessCandidates<T extends Customer>(
  list: readonly T[],
): PhonelessCandidate<T>[] {
  const byToken = new Map<string, T[]>();
  for (const c of list) {
    if (!c.phone) continue;
    const t = guessableFirstToken(c);
    if (!t) continue;
    const arr = byToken.get(t);
    if (arr) arr.push(c);
    else byToken.set(t, [c]);
  }

  const out: PhonelessCandidate<T>[] = [];
  for (const c of list) {
    if (c.phone) continue;
    const t = guessableFirstToken(c);
    if (!t) continue;
    const matches = byToken.get(t);
    if (matches?.length === 1) out.push({ noPhone: c, candidate: matches[0] });
  }
  return out;
}

/** Qué tan completa está una ficha: se sugiere como principal la más completa. */
export function completeness(c: Customer): number {
  const fields = [
    c.phone,
    c.email,
    c.nickname,
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

/**
 * Campos editables de una ficha, tal como salen de un formulario abierto.
 *
 * Hace falta porque el caso más común de combinación aparece justo mientras se
 * corrigen los datos: se escribe el WhatsApp en la ficha incompleta de una cita
 * y resulta que ese número ya es de otra ficha. Lo que se acaba de escribir no
 * está en la DB todavía, así que viaja aparte y se aplica sobre la fila a la que
 * pertenece (`patches` va indexado por id de cliente). Después se combina con
 * las reglas de siempre: el principal gana, el otro rellena los huecos.
 */
export interface CustomerPatch {
  first_name?: string;
  last_name?: string | null;
  nickname?: string | null;
  imported_name?: string | null;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  preferred_staff_id?: string | null;
  notes?: string | null;
  allergies?: string | null;
  hair_notes?: string | null;
}

/** Cambios sin guardar por id de contacto. */
export type CustomerPatches = Record<string, CustomerPatch | undefined>;

/** La ficha como quedaría con los cambios del formulario aplicados. */
export function patchedCustomer<T extends Customer>(
  c: T,
  patch?: CustomerPatch,
): T {
  if (!patch) return c;
  const out = { ...c };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}


/** Texto del principal; si el duplicado aporta algo distinto, se conserva abajo. */
function joinText(a: string | null, b: string | null): string | null {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x) return y || null;
  if (!y || normalizeText(x).includes(normalizeText(y))) return x;
  return `${x}\n${y}`;
}

/**
 * Igual que `joinText` pero en una sola línea: el nombre en la agenda se edita
 * en un <input>, no en un textarea, así que los dos van separados por " / ".
 */
function joinOneLine(a: string | null, b: string | null): string | null {
  return joinText(a, b)?.replace(/\n+/g, ' / ') ?? null;
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
    nickname: firstOf(keep.nickname, dup.nickname),
    // El nombre de la agenda del duplicado sirve igual que el del principal
    // para encontrar el contacto en el teléfono, así que se conservan los dos.
    imported_name: joinOneLine(keep.imported_name, dup.imported_name),
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
 *
 * `patches` son los cambios sin guardar del formulario desde el que se combina
 * (ver `CustomerPatch`): se aplican sobre la fila releída de su propio contacto.
 */
export async function mergeCustomers(
  keep: Customer,
  dup: Customer,
  patches?: CustomerPatches,
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

  // Los cambios sin guardar del formulario entran antes de fusionar, para que
  // el teléfono recién escrito sea el que gana y no el que está en la fila.
  const f = mergedFields(
    patchedCustomer(keepNow, patches?.[keepNow.id]),
    patchedCustomer(dupNow, patches?.[dupNow.id]),
  );

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
              first_name = ?, last_name = ?, nickname = ?, imported_name = ?,
              phone = ?, email = ?,
              birth_date = ?, preferred_staff_id = ?, notes = ?,
              allergies = ?, hair_notes = ?, first_visit_at = ?,
              last_visit_at = ?, active = 1, updated_at = ?
            WHERE id = ?`,
      args: [
        f.first_name,
        f.last_name,
        f.nickname,
        f.imported_name,
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

/* ─────────────── Usar un contacto existente (sin combinar) ─────────────── */

/** Cómo se nombra cada campo en el aviso de "se completó con…". */
const FIELD_LABELS: Record<keyof CustomerPatch, string> = {
  first_name: 'nombre',
  last_name: 'apellido',
  nickname: 'alias',
  imported_name: 'nombre en la agenda',
  phone: 'WhatsApp',
  email: 'email',
  birth_date: 'cumpleaños',
  preferred_staff_id: 'estilista preferido',
  notes: 'notas',
  allergies: 'alergias',
  hair_notes: 'notas capilares',
};

export interface GapFill {
  stmt: Stmt;
  /** Campos que se completaron, en español, para avisar qué se agregó. */
  fields: string[];
  /** Nombre que tenía la ficha antes de renombrarla, o null si no se renombró. */
  renamedFrom: string | null;
}

const blank = (v: string | null | undefined) => !v || v.trim() === '';

/**
 * Nombre con el que quedaría la ficha existente si se la usa con lo escrito en
 * el formulario, o `null` si no hay que renombrar (no se escribió nombre, o es
 * el mismo que ya tiene).
 *
 * Lo necesita el aviso de duplicado para poder decir a qué se renombra antes de
 * que se toque el botón: el nombre es el único dato que el renombrado pisa.
 */
export function renamedName(
  target: Customer,
  patch: CustomerPatch,
): string | null {
  const first = patch.first_name?.trim() ?? '';
  if (!first) return null;
  const next = fullName(first, patch.last_name?.trim() || null);
  const current = fullName(target.first_name, target.last_name);
  return normalizeText(next) === normalizeText(current) ? null : next;
}

/**
 * Usar una ficha que ya existe con lo que se acaba de escribir: le pone el
 * nombre tipeado y le completa los campos que tenía vacíos.
 *
 * Es la otra salida del duplicado por teléfono: cuando no hay dos fichas que
 * combinar (se estaba creando una nueva, o la cita todavía no tenía cliente) lo
 * correcto es usar la que ya existe sin tirar lo que se acababa de pedir.
 *
 * El nombre es el único dato que se pisa, y a propósito: el que está en la
 * ficha vino de la agenda del teléfono o del título de un evento, y el que se
 * acaba de escribir es el real —se pregunta justamente para normalizar e ir a
 * facturación—. El viejo no se pierde: baja a `nickname` si no había alias, que
 * es como se la conoce. NO se copia a `imported_name`: en los contactos del
 * .vcf ese campo ya tiene ese mismo nombre, y en los que creó el sync de Google
 * Calendar sería mentira (nunca estuvieron en la agenda del teléfono).
 *
 * Devuelve `null` si no hay nada que cambiar; el statement se puede combinar en
 * un batch con, por ejemplo, el UPDATE que ata la cita al contacto.
 */
export function fillCustomerGaps(
  target: Customer,
  patch: CustomerPatch,
): GapFill | null {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  const fields: string[] = [];
  /** Campos ya resueltos por el renombrado: el bucle de huecos no los toca. */
  const done = new Set<keyof CustomerPatch>();

  const put = (col: keyof CustomerPatch, value: string | null) => {
    sets.push(`${col} = ?`);
    args.push(value);
    done.add(col);
  };

  const renamedFrom = renamedName(target, patch)
    ? fullName(target.first_name, target.last_name)
    : null;

  if (renamedFrom) {
    put('first_name', patch.first_name!.trim());
    put('last_name', patch.last_name?.trim() || null);
    if (blank(target.nickname)) {
      put('nickname', renamedFrom);
      fields.push(`alias "${renamedFrom}"`);
    }
  }

  for (const [key, label] of Object.entries(FIELD_LABELS) as [
    keyof CustomerPatch,
    string,
  ][]) {
    if (done.has(key)) continue;
    const value = patch[key];
    if (blank(value)) continue;
    if (!blank(target[key])) continue;
    sets.push(`${key} = ?`);
    args.push(value ?? null);
    fields.push(label);
  }
  if (sets.length === 0) return null;

  return {
    stmt: {
      sql: `UPDATE customer SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`,
      args: [...args, new Date().toISOString(), target.id],
    },
    fields,
    renamedFrom,
  };
}

/**
 * Qué decirle a la usuaria después de usar una ficha existente. Se arma acá
 * porque las tres pantallas que ofrecen "usar ese contacto" (Clientes, Reservar
 * y Nueva venta) mostraban el mismo aviso con palabras distintas.
 */
export function gapFillSummary(gap: GapFill | null): string {
  if (!gap) return 'Ya tenía todos esos datos.';
  const parts: string[] = [];
  if (gap.renamedFrom) parts.push(`Antes era "${gap.renamedFrom}".`);
  if (gap.fields.length > 0) parts.push(`Se le completó: ${gap.fields.join(', ')}.`);
  return parts.join(' ') || 'Ya tenía todos esos datos.';
}
