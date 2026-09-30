/**
 * Integración con Google Calendar desde el cliente.
 *
 * Acá NO hay OAuth ni tokens: todo pasa por el Worker en POST /api/gcal, que
 * firma con una service account (worker/gcal.ts). Antes esto usaba Google
 * Identity Services en el navegador y cada usuaria tenía que iniciar sesión con
 * su cuenta de Google, chocando con la pantalla de "app en modo de prueba". El
 * calendario es del salón, no de cada usuaria: el único login de la app es
 * Cloudflare Access.
 *
 * El calendario destino es siempre `branch.google_calendar_id` (la service
 * account no tiene "primary"); si falta, el servidor devuelve un error claro.
 *
 * La cita SIEMPRE se guarda en la BDD; el evento en Google es un extra y sus
 * fallas nunca deben tumbar el guardado local.
 */

import { GOOGLE_EVENT_COLORS as PALETTE_EVENT_COLORS } from '@/config/colors';

/**
 * Zona horaria para los eventos. El sistema guarda y muestra las horas como
 * "hora de pared local" (toLocalNaive + new Date), así que Google DEBE
 * interpretarlas en esa misma zona; si mandamos una zona fija distinta a la del
 * equipo, el evento se corre de día/hora. Usamos la zona real del navegador.
 */
const TIMEZONE =
  (typeof Intl !== 'undefined' &&
    Intl.DateTimeFormat().resolvedOptions().timeZone) ||
  'America/Guayaquil';

/**
 * `false` solo cuando el servidor confirmó que no hay service account. Arranca
 * en `true` para que la UI de calendario se pinte sin esperar un round-trip: si
 * no está configurado, el primer /api/gcal lo corrige y las acciones fallan de
 * forma controlada (la cita local ya quedó guardada).
 */
let serverConfigured = true;

export const isGoogleCalendarEnabled = (): boolean => serverConfigured;

interface GcalPayload {
  action: 'create' | 'patch' | 'delete' | 'list' | 'status';
  calendarId?: string | null;
  eventId?: string;
  timeZone?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  startLocal?: string;
  endLocal?: string;
  timeMinIso?: string;
  timeMaxIso?: string;
}

/** Llama al puente del Worker. Lanza Error con el mensaje que mandó el server. */
async function callGcal<T>(payload: GcalPayload): Promise<T> {
  const res = await fetch('/api/gcal', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timeZone: TIMEZONE, ...payload }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  // 503 = el servidor no tiene la service account: apagamos la integración.
  if (res.status === 503) {
    serverConfigured = false;
    throw new Error(data.error ?? 'Google Calendar no está configurado.');
  }
  if (!res.ok) {
    throw new Error(data.error ?? `Google Calendar respondió ${res.status}.`);
  }
  return data as T;
}

/**
 * Diagnóstico para la UI: dice si el servidor tiene la service account y si
 * llega al calendario de la sucursal. No lanza; devuelve el detalle.
 */
export async function checkGoogleCalendar(
  calendarId?: string | null,
): Promise<{
  ok: boolean;
  serviceAccount?: string | null;
  calendarId?: string | null;
  error?: string;
}> {
  try {
    const r = await callGcal<{
      configured: boolean;
      serviceAccount?: string | null;
      calendarId?: string | null;
      error?: string;
    }>({ action: 'status', calendarId });
    serverConfigured = r.configured;
    return {
      ok: r.configured && !r.error,
      serviceAccount: r.serviceAccount ?? null,
      calendarId: r.calendarId ?? null,
      error: r.error,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Colores de evento de Google (colorId 1..11), tomados de la paleta única de
 * config/colors. Google no acepta hex arbitrario en un evento: cualquier otro
 * color del colaborador se mapea al colorId más cercano.
 */
const GOOGLE_EVENT_COLORS = PALETTE_EVENT_COLORS.map((c) => ({
  id: c.eventId,
  hex: c.hex,
}));

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Devuelve el hex oficial de un colorId de Google (1..11), o null. */
export function googleColorIdToHex(colorId?: string | null): string | null {
  if (!colorId) return null;
  const c = GOOGLE_EVENT_COLORS.find((x) => x.id === String(colorId));
  return c ? c.hex : null;
}

/** Mapea un color hex del colaborador al colorId de Google más cercano. */
export function hexToGoogleColorId(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  let best = GOOGLE_EVENT_COLORS[0];
  let bestDist = Infinity;
  for (const c of GOOGLE_EVENT_COLORS) {
    const [r, g, b] = parseHex(c.hex)!;
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.id;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  /** Hora local naive "YYYY-MM-DDTHH:mm:ss" (se envía con timeZone). */
  startLocal: string;
  endLocal: string;
  /** Calendario destino (por sucursal). Vacío → 'primary'. */
  calendarId?: string | null;
  /** Color del colaborador (hex). Se mapea al colorId de Google. */
  colorHex?: string | null;
}

/** Crea el evento en el calendario de la sucursal y devuelve su id. */
export async function createCalendarEvent(
  input: CalendarEventInput,
): Promise<string> {
  const { id } = await callGcal<{ id: string }>({
    action: 'create',
    calendarId: input.calendarId,
    summary: input.summary,
    description: input.description,
    startLocal: input.startLocal,
    endLocal: input.endLocal,
    colorId: hexToGoogleColorId(input.colorHex),
  });
  return id;
}

/** Actualiza (PATCH) campos de un evento existente. Best-effort. */
export async function updateCalendarEvent(
  eventId: string,
  calendarId: string | null | undefined,
  patch: {
    summary?: string;
    description?: string;
    colorHex?: string | null;
    startLocal?: string;
    endLocal?: string;
  },
): Promise<void> {
  await callGcal<{ ok: boolean }>({
    action: 'patch',
    calendarId,
    eventId,
    summary: patch.summary,
    description: patch.description,
    colorId: hexToGoogleColorId(patch.colorHex),
    startLocal: patch.startLocal,
    endLocal: patch.endLocal,
  });
}

/* ─────────────────────── Lectura / exportación ──────────────────────── */

/** Evento crudo de Google Calendar (solo los campos que usamos). */
export interface RawCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string }[];
  created?: string;
  updated?: string;
}

/** Evento normalizado para exportar/mapear (color ya resuelto a hex). */
export interface ExportedEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  colorId: string | null;
  colorHex: string | null;
  /** Hora local naive "YYYY-MM-DDTHH:mm:ss" cuando el evento tiene hora. */
  startLocal: string | null;
  endLocal: string | null;
  /** true si es evento de día completo (sin hora). */
  allDay: boolean;
  attendees: { email: string | null; name: string | null }[];
}

/** ISO/fecha → naive local "YYYY-MM-DDTHH:mm:ss" (o null si es all-day). */
function toNaiveLocal(dt?: { dateTime?: string; date?: string }): {
  local: string | null;
  allDay: boolean;
} {
  if (!dt) return { local: null, allDay: false };
  if (dt.date && !dt.dateTime) return { local: `${dt.date}T00:00:00`, allDay: true };
  if (!dt.dateTime) return { local: null, allDay: false };
  const d = new Date(dt.dateTime);
  if (Number.isNaN(d.getTime())) return { local: null, allDay: false };
  const p = (n: number) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return { local, allDay: false };
}

/**
 * Lista los eventos de un calendario en un rango (paginado en el Worker).
 * Se usa para la exportación/migración; no requiere login de Google.
 */
export async function listCalendarEvents(opts: {
  calendarId?: string | null;
  timeMinIso: string;
  timeMaxIso: string;
}): Promise<RawCalendarEvent[]> {
  const { items } = await callGcal<{ items: RawCalendarEvent[] }>({
    action: 'list',
    calendarId: opts.calendarId,
    timeMinIso: opts.timeMinIso,
    timeMaxIso: opts.timeMaxIso,
  });
  return items ?? [];
}

/** Normaliza eventos crudos a `ExportedEvent` (color resuelto, horas locales). */
export function normalizeEvents(raw: RawCalendarEvent[]): ExportedEvent[] {
  return raw
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const s = toNaiveLocal(e.start);
      const en = toNaiveLocal(e.end);
      return {
        id: e.id,
        summary: (e.summary ?? '').trim(),
        description: e.description?.trim() || null,
        location: e.location?.trim() || null,
        colorId: e.colorId ?? null,
        colorHex: googleColorIdToHex(e.colorId),
        startLocal: s.local,
        endLocal: en.local,
        allDay: s.allDay,
        attendees: (e.attendees ?? []).map((a) => ({
          email: a.email ?? null,
          name: a.displayName ?? null,
        })),
      };
    });
}

/** Borra un evento del calendario (best-effort). No lanza si ya no existe. */
export async function deleteCalendarEvent(
  eventId: string,
  calendarId?: string | null,
): Promise<void> {
  await callGcal<{ ok: boolean }>({ action: 'delete', calendarId, eventId });
}
