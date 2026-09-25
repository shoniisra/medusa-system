import type { Client } from '@libsql/client/web';

/**
 * Sincronización de eventos de Google Calendar → citas del sistema.
 *
 * Lo dispara un Google Apps Script (trigger por edición del calendario) que
 * hace POST /api/gcal-sync con los eventos que cambiaron. Este módulo:
 *   1. Autentica con un secreto compartido (defensa en profundidad; la ruta
 *      además está protegida por un service token de Cloudflare Access).
 *   2. Mapea color del evento → estilista (tabla gcal_color_map, editable).
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
  colorId?: string | null; // '1'..'11' o null (color por defecto)
}

interface SyncPayload {
  calendarId: string;
  events: EventInput[];
}

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

/** Extrae abono, texto de servicio y nombre de cliente de un título libre. */
function parseTitle(
  summary: string,
  services: ServiceRow[],
): { deposit: number; service: ServiceRow | null; customer: string | null } {
  const raw = summary.trim();

  // Abono: "$10", "abono 10", "abono $10".
  let deposit = 0;
  const depMatch =
    raw.match(/abono[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i) ||
    raw.match(/\$\s*([0-9]+(?:[.,][0-9]+)?)/);
  if (depMatch) deposit = Number(depMatch[1].replace(',', '.')) || 0;

  const nraw = norm(raw);

  // Servicio: elegimos el servicio cuyo nombre comparte más palabras (≥4 letras)
  // significativas con el título. Empate → nombre más corto.
  let best: ServiceRow | null = null;
  let bestScore = 0;
  for (const svc of services) {
    if (/por definir/i.test(svc.name)) continue; // placeholders no compiten
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

  // Nombre de cliente: quitamos el nombre del servicio y el abono del título.
  let customer: string | null = raw
    .replace(/abono[^0-9]*[0-9]+(?:[.,][0-9]+)?/i, '')
    .replace(/\$\s*[0-9]+(?:[.,][0-9]+)?/g, '')
    .trim();
  if (best) {
    for (const w of norm(best.name)
      .split(/[^a-z0-9]+/)
      .filter((x) => x.length >= 4)) {
      customer = customer!.replace(new RegExp(w, 'gi'), '');
    }
  }
  customer = (customer ?? '').replace(/[\s\-–—·,|]+/g, ' ').trim();
  if (customer.length < 2) customer = null;

  return { deposit, service: best, customer };
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
  const row = existing.rows[0] as { id: string } | undefined;
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
  const branch = branchRs.rows[0] as
    | { id: string; organization_id: string }
    | undefined;
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
  for (const r of colorRs.rows as { google_color_id: string; staff_id: string }[])
    colorMap.set(r.google_color_id, r.staff_id);

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

    // Cancelaciones: marcar la cita, sin tocar nada más.
    if (ev.status === 'cancelled') {
      const rs = await db.execute({
        sql: `UPDATE appointment SET status = 'cancelled', updated_at = ?
                WHERE google_calendar_event_id = ? AND branch_id = ?
                  AND status NOT IN ('attended')`,
        args: [new Date().toISOString(), ev.id, branchId],
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
    const staffId = ev.colorId ? colorMap.get(ev.colorId) ?? null : null;

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
      sql: `SELECT id FROM appointment WHERE google_calendar_event_id = ? AND branch_id = ? LIMIT 1`,
      args: [ev.id, branchId],
    });
    const existing = existingRs.rows[0] as { id: string } | undefined;

    if (existing) {
      // No tocamos el estado (respeta un "Atender" hecho en la app).
      await db.batch(
        [
          {
            sql: `UPDATE appointment
                    SET start_at = ?, end_at = ?, customer_id = COALESCE(?, customer_id),
                        deposit_amount = ?, deposit_required = ?, notes = ?, updated_at = ?
                  WHERE id = ?`,
            args: [
              startAt,
              endAt,
              customerId,
              deposit,
              deposit > 0 ? 1 : 0,
              notes,
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
                     google_calendar_id, google_calendar_event_id, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)`,
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
