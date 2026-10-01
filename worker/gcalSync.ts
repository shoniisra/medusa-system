import type { Client } from '@libsql/client/web';

/**
 * libsql devuelve filas como `Row` (un objeto indexable) y TypeScript no lo
 * considera compatible con la forma concreta que sabemos que tiene cada
 * consulta. Estos dos helpers concentran ese cast en un solo lugar en vez de
 * repartir `as unknown as` por el archivo.
 */
const asRow = <T,>(row: unknown): T | undefined => row as T | undefined;
const asRows = <T,>(rows: unknown[]): T[] => rows as T[];


/**
 * Sincronización de eventos de Google Calendar → citas del sistema.
 *
 * Lo dispara un Google Apps Script (trigger por edición del calendario) que
 * hace POST /api/gcal-sync con los eventos que cambiaron. Este módulo:
 *   1. Autentica con un secreto compartido (defensa en profundidad; la ruta
 *      además está protegida por un service token de Cloudflare Access).
 *   2. Mapea color del evento → estilista: primero la tabla gcal_color_map
 *      (por colorId), y si no hay entrada, por el hex del color contra el color
 *      identificador de cada colaboradora.
 *   3. Parsea el título libre (nombre + servicio + abono) de forma heurística.
 *   4. Hace upsert idempotente por google_calendar_event_id.
 *
 * Todo lo dudoso entra con la marca [Revisar] en notas para que el salón lo
 * confirme en la app. El abono se guarda como dato de la cita (deposit_amount),
 * NO como pago —eso se confirma al cobrar—.
 */

interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GCAL_SYNC_SECRET: string;
}

/** Un evento tal como lo manda el Apps Script (horas en zona local del salón). */
interface EventInput {
  id: string;
  status?: string; // 'confirmed' | 'cancelled' | 'tentative'
  summary?: string;
  startLocal?: string | null; // 'YYYY-MM-DDTHH:mm:ss' o null (todo el día)
  endLocal?: string | null;
  colorId?: string | null; // id del color del evento, o null
  /** Hex del color ya resuelto por el Apps Script contra la paleta de Google. */
  colorHex?: string | null;
}

interface SyncPayload {
  calendarId: string;
  events: EventInput[];
}

/** colorId que manda el Apps Script cuando el evento hereda el color del calendario. */
const DEFAULT_COLOR_ID = 'default';

const REVIEW_MARK = '[Revisar]';
const AUTO_MARK = 'Auto-sync Google Calendar';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  base_price: number;
}

interface StaffColorRow {
  id: string;
  color: string | null;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Tolerancia al comparar colores: Google puede devolver un hex apenas distinto
 * al guardado. Es un margen chico a propósito —un color parecido NO alcanza—,
 * así que dos colaboradoras con colores distintos nunca se confunden.
 */
const COLOR_TOLERANCE = 1200; // ≈ 20 puntos por canal

/**
 * Busca la colaboradora cuyo color identificador es el del evento. Es el
 * respaldo de `gcal_color_map`: como el color del equipo sale de la paleta de
 * Google, pintar el evento con ese color alcanza para asignar la cita.
 */
function staffByColor(
  hex: string | null | undefined,
  staff: StaffColorRow[],
): string | null {
  if (!hex) return null;
  const rgb = parseHex(hex);
  if (!rgb) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const s of staff) {
    const c = s.color ? parseHex(s.color) : null;
    if (!c) continue;
    const d =
      (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = s.id;
    }
  }
  return bestDist <= COLOR_TOLERANCE ? best : null;
}

/**
 * Sinónimos informales → servicio del catálogo (por substring del nombre, sin
 * acentos). El salón escribe cosas como "uñas", "semi", "poligel"; acá las
 * mapeamos al servicio real. Editá esta lista para afinar el reconocimiento.
 */
function matchBySynonym(nraw: string, services: ServiceRow[]): ServiceRow | null {
  const find = (sub: string) =>
    services.find((s) => norm(s.name).includes(norm(sub))) ?? null;
  const has = (re: RegExp) => re.test(nraw);
  const semi = has(/\bsemi/);
  const pedi = has(/\bpedic|\bpedi\b/);

  if (has(/lifting/)) return find('lifting de pestañas');
  if (has(/poligel/)) return find('extension - poligel normal');
  if (has(/acril/)) return find('acrilico normal');
  if (has(/cejas?/)) return find('diseño de cejas');
  if (has(/pesta/)) return find('pestañas - aplicacion');
  if (has(/maquilla/)) return find('maquillaje social basico (sin pesta');
  if (pedi && semi) return find('pedicura - esmaltado semipermante');
  if (pedi) return find('pedicura - esmaltado');
  if (semi) return find('esmaltado semipermanente - normal'); // manicura
  if (has(/\bunas?\b|manicur/)) return find('manicura (por definir)');
  return null;
}

/** Palabras de servicio/relleno a excluir del nombre de cliente (sin acentos). */
const STOPWORDS = new Set([
  'unas', 'una', 'semi', 'semipermanente', 'poligel', 'acrilico', 'pedicura',
  'pedi', 'manicura', 'lifting', 'cejas', 'ceja', 'pestanas', 'pestana',
  'maquillaje', 'color', 'coloracion', 'corte', 'peinado', 'retiro', 'retoque',
  'esmaltado', 'bano', 'matiz', 'tinte', 'familiar', 'sobrina', 'sobrino',
  'mujeres', 'mujer', 'hombres', 'hombre', 'clienta', 'cliente', 'am', 'pm',
]);
const CONNECTORS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'para', 'x', 'al', 'a',
  'en', 'o', 'su',
]);

/** Extrae abono, servicio y nombre de cliente de un título libre. */
function parseTitle(
  summary: string,
  services: ServiceRow[],
): { deposit: number; service: ServiceRow | null; customer: string | null } {
  const raw = summary.trim();

  // Abono: "$10", "abono 10", "abona 5", "abonó 5".
  let deposit = 0;
  const depMatch =
    raw.match(/abon\w*[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i) ||
    raw.match(/\$\s*([0-9]+(?:[.,][0-9]+)?)/);
  if (depMatch) deposit = Number(depMatch[1].replace(',', '.')) || 0;

  const nraw = norm(raw);

  // 1) Sinónimos informales. 2) Si no, match por palabras del nombre del servicio.
  let best = matchBySynonym(nraw, services);
  if (!best) {
    let bestScore = 0;
    for (const svc of services) {
      if (/por definir/i.test(svc.name)) continue;
      const words = norm(svc.name)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !['cabello', 'servicio'].includes(w));
      let score = 0;
      for (const w of words) if (nraw.includes(w)) score += w.length;
      if (
        score > bestScore ||
        (score === bestScore && best && svc.name.length < best.name.length)
      ) {
        bestScore = score;
        if (score > 0) best = svc;
      }
    }
  }

  // Nombre de cliente: tokenizamos y descartamos abono, números, conectores,
  // palabras de servicio y las palabras del servicio que matcheó. Comparamos sin
  // acentos, pero conservamos el token original (con mayúsculas/acentos) al unir.
  const svcWords = best
    ? new Set(
        norm(best.name)
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3),
      )
    : new Set<string>();
  const kept = raw
    .split(/[\s\-–—·,|:]+/)
    .filter((tok) => {
      const n = norm(tok);
      if (n.length < 2) return false;
      if (/^\$?[0-9]+(?:[.,][0-9]+)?$/.test(n)) return false; // números / abono
      if (/^abon/.test(n)) return false;
      if (STOPWORDS.has(n) || CONNECTORS.has(n) || svcWords.has(n)) return false;
      return true;
    });
  const clean: string | null = kept.length ? kept.join(' ') : null;

  return { deposit, service: best, customer: clean };
}

async function findOrCreateCustomer(
  db: Client,
  orgId: string,
  name: string,
): Promise<string> {
  const existing = await db.execute({
    sql: `SELECT id FROM customer
           WHERE organization_id = ? AND lower(first_name) = lower(?)
           LIMIT 1`,
    args: [orgId, name],
  });
  const row = asRow<{ id: string }>(existing.rows[0]);
  if (row) return row.id;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO customer
            (id, organization_id, first_name, notes, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)`,
    args: [id, orgId, name, AUTO_MARK, now, now],
  });
  return id;
}

/** Suma 1 hora a un naive 'YYYY-MM-DDTHH:mm:ss'. */
function plusOneHour(local: string): string {
  const d = new Date(local);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function handleGcalSync(
  request: Request,
  env: Env,
  db: Client,
): Promise<Response> {
  // 1) Autenticación por secreto compartido.
  if (request.headers.get('x-gcal-secret') !== env.GCAL_SYNC_SECRET) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SyncPayload | null;
  if (!body?.calendarId || !Array.isArray(body.events)) {
    return Response.json({ error: 'Payload inválido' }, { status: 400 });
  }

  // 2) Resolver sucursal por su google_calendar_id.
  const branchRs = await db.execute({
    sql: `SELECT id, organization_id FROM branch WHERE google_calendar_id = ? LIMIT 1`,
    args: [body.calendarId],
  });
  const branch = asRow<{ id: string; organization_id: string }>(branchRs.rows[0]);
  if (!branch) {
    return Response.json(
      { error: 'Calendario no vinculado a ninguna sucursal' },
      { status: 404 },
    );
  }
  const branchId = branch.id;
  const orgId = branch.organization_id;

  // 3) Cargar mapa de colores y catálogo de servicios una sola vez.
  const colorRs = await db.execute({
    sql: `SELECT google_color_id, staff_id FROM gcal_color_map WHERE branch_id = ?`,
    args: [branchId],
  });
  const colorMap = new Map<string, string>();
  for (const r of asRows<{ google_color_id: string; staff_id: string }>(colorRs.rows))
    colorMap.set(r.google_color_id, r.staff_id);

  const staffRs = await db.execute({
    sql: `SELECT id, color FROM staff_member
           WHERE organization_id = ? AND active = 1`,
    args: [orgId],
  });
  const staffColors = staffRs.rows as unknown as StaffColorRow[];

  const svcRs = await db.execute({
    sql: `SELECT id, name, category, base_price FROM service
           WHERE organization_id = ? AND active = 1`,
    args: [orgId],
  });
  const services = svcRs.rows as unknown as ServiceRow[];
  const placeholder =
    services.find((s) => /^servicio \(por definir\)/i.test(s.name)) ??
    services[0];

  const summary = { created: 0, updated: 0, cancelled: 0, skipped: 0, review: 0 };

  for (const ev of body.events) {
    if (!ev.id) {
      summary.skipped++;
      continue;
    }

    // El import viejo guardó el iCalUID (<id>@google.com); Apps Script manda el
    // <id> de la API. Para eventos no recurrentes son el mismo evento, así que
    // buscamos por ambas claves y evitamos duplicar lo ya importado.
    const altId = `${ev.id}@google.com`;

    // Cancelaciones: marcar la cita, sin tocar nada más.
    if (ev.status === 'cancelled') {
      const rs = await db.execute({
        sql: `UPDATE appointment SET status = 'cancelled', updated_at = ?
                WHERE google_calendar_event_id IN (?, ?) AND branch_id = ?
                  AND status NOT IN ('attended')`,
        args: [new Date().toISOString(), ev.id, altId, branchId],
      });
      if (rs.rowsAffected > 0) summary.cancelled++;
      else summary.skipped++;
      continue;
    }

    // Eventos de todo el día (sin hora) no son citas: los omitimos.
    if (!ev.startLocal) {
      summary.skipped++;
      continue;
    }
    const startAt = ev.startLocal;
    const endAt =
      ev.endLocal && ev.endLocal > ev.startLocal
        ? ev.endLocal
        : plusOneHour(startAt);

    const title = (ev.summary ?? '').trim() || 'Cita sin título';
    const { deposit, service, customer } = parseTitle(title, services);
    // 1) mapa manual por colorId (gcal_color_map) · 2) color del evento contra
    // el color identificador de cada colaboradora.
    //
    // Los eventos sin color propio llegan con colorId 'default' (heredan el del
    // calendario). Para esos vale solo el mapa: adivinar por hex le asignaría el
    // calendario entero a quien tenga ese color.
    const colorHex = ev.colorHex?.trim() || null;
    const ownColor = !!ev.colorId && ev.colorId !== DEFAULT_COLOR_ID;
    const staffId =
      (ev.colorId ? colorMap.get(ev.colorId) ?? null : null) ??
      (ownColor ? staffByColor(colorHex, staffColors) : null);

    // ¿Necesita revisión manual? Sin estilista, sin servicio o sin nombre.
    const needsReview = !staffId || !service || !customer;
    if (needsReview) summary.review++;

    const svcId = service?.id ?? placeholder?.id ?? null;
    const svcName = service?.name ?? title;
    const price = service?.base_price ?? 0;
    const category = service?.category ?? null;

    const customerId = customer
      ? await findOrCreateCustomer(db, orgId, customer)
      : null;

    const noteParts = [AUTO_MARK];
    if (deposit > 0) noteParts.push(`Abono: ${deposit}`);
    if (needsReview) noteParts.push(REVIEW_MARK);
    const notes = noteParts.join(' · ');

    const now = new Date().toISOString();
    const existingRs = await db.execute({
      sql: `SELECT id, status FROM appointment
             WHERE google_calendar_event_id IN (?, ?) AND branch_id = ? LIMIT 1`,
      args: [ev.id, altId, branchId],
    });
    const existing = asRow<{ id: string; status: string }>(existingRs.rows[0]);

    // Cita ya atendida (facturada): no la pisamos con datos de Google.
    if (existing && existing.status === 'attended') {
      summary.skipped++;
      continue;
    }

    if (existing) {
      // No tocamos el estado (respeta un "Atender" hecho en la app).
      await db.batch(
        [
          {
            sql: `UPDATE appointment
                    SET start_at = ?, end_at = ?, customer_id = COALESCE(?, customer_id),
                        deposit_amount = ?, deposit_required = ?, notes = ?,
                        google_color_id = ?, google_color_hex = ?, updated_at = ?
                  WHERE id = ?`,
            args: [
              startAt,
              endAt,
              customerId,
              deposit,
              deposit > 0 ? 1 : 0,
              notes,
              ev.colorId ?? null,
              colorHex,
              now,
              existing.id,
            ],
          },
          {
            sql: `DELETE FROM appointment_item WHERE appointment_id = ?`,
            args: [existing.id],
          },
          {
            sql: `INSERT INTO appointment_item
                    (id, appointment_id, service_id, category, description, quantity,
                     list_unit_price, discount_amount, final_unit_price, assigned_staff_id)
                  VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
            args: [
              crypto.randomUUID(),
              existing.id,
              svcId,
              category,
              svcName,
              price,
              price,
              staffId,
            ],
          },
        ],
        'write',
      );
      summary.updated++;
    } else {
      const apptId = crypto.randomUUID();
      await db.batch(
        [
          {
            sql: `INSERT INTO appointment
                    (id, organization_id, branch_id, customer_id, start_at, end_at,
                     status, deposit_required, deposit_amount, notes,
                     google_calendar_id, google_calendar_event_id,
                     google_color_id, google_color_hex, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              apptId,
              orgId,
              branchId,
              customerId,
              startAt,
              endAt,
              deposit > 0 ? 1 : 0,
              deposit,
              notes,
              body.calendarId,
              ev.id,
              ev.colorId ?? null,
              colorHex,
              now,
              now,
            ],
          },
          {
            sql: `INSERT INTO appointment_item
                    (id, appointment_id, service_id, category, description, quantity,
                     list_unit_price, discount_amount, final_unit_price, assigned_staff_id)
                  VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
            args: [
              crypto.randomUUID(),
              apptId,
              svcId,
              category,
              svcName,
              price,
              price,
              staffId,
            ],
          },
        ],
        'write',
      );
      summary.created++;
    }
  }

  return Response.json({ ok: true, ...summary });
}
