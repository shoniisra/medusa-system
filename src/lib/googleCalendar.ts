/**
 * Integración opcional con Google Calendar (Google Identity Services, flujo de
 * token en el navegador). Se activa solo si existe VITE_GOOGLE_CLIENT_ID.
 *
 * Requisitos para activarla:
 *  1. Crear un proyecto en Google Cloud Console.
 *  2. Habilitar "Google Calendar API".
 *  3. Crear credenciales OAuth 2.0 (tipo "Aplicación web"), agregar el origen
 *     (ej. http://localhost:5173 y el dominio de producción).
 *  4. Poner el Client ID en .env → VITE_GOOGLE_CLIENT_ID.
 *
 * La cita SIEMPRE se guarda en la BDD; el evento en Google es un extra que el
 * usuario habilita con un checkbox (consentimiento explícito por acción).
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

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

export const isGoogleCalendarEnabled = (): boolean => !!CLIENT_ID;

/* Tipos mínimos de GIS para no depender de @types/google.accounts. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }) => TokenClient;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;
let cachedToken: string | null = null;
let cachedExpiry = 0;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity.'));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error('Google Calendar no está configurado.');
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;
  await loadGis();

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'Autorización de Google cancelada.'));
          return;
        }
        cachedToken = resp.access_token;
        cachedExpiry = Date.now() + ((resp.expires_in ?? 3600) - 60) * 1000;
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/**
 * Paleta oficial de colores de eventos de Google Calendar (colorId 1..11).
 * Google no acepta hex arbitrario en eventos: se mapea al colorId más cercano.
 */
const GOOGLE_EVENT_COLORS: { id: string; hex: string }[] = [
  { id: '1', hex: '#7986CB' }, // Lavanda
  { id: '2', hex: '#33B679' }, // Salvia
  { id: '3', hex: '#8E24AA' }, // Uva
  { id: '4', hex: '#E67C73' }, // Flamenco
  { id: '5', hex: '#F6BF26' }, // Banana
  { id: '6', hex: '#F4511E' }, // Mandarina
  { id: '7', hex: '#039BE5' }, // Pavo real
  { id: '8', hex: '#616161' }, // Grafito
  { id: '9', hex: '#3F51B5' }, // Arándano
  { id: '10', hex: '#0B8043' }, // Albahaca
  { id: '11', hex: '#D50000' }, // Tomate
];

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
  const token = await getAccessToken();
  const calId = encodeURIComponent(input.calendarId?.trim() || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startLocal, timeZone: TIMEZONE },
        end: { dateTime: input.endLocal, timeZone: TIMEZONE },
        colorId: hexToGoogleColorId(input.colorHex),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Google Calendar respondió ${res.status}.`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
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
  const token = await getAccessToken();
  const calId = encodeURIComponent(calendarId?.trim() || 'primary');
  const body: Record<string, unknown> = {};
  if (patch.summary != null) body.summary = patch.summary;
  if (patch.description != null) body.description = patch.description;
  if (patch.colorHex) {
    const cid = hexToGoogleColorId(patch.colorHex);
    if (cid) body.colorId = cid;
  }
  if (patch.startLocal) body.start = { dateTime: patch.startLocal, timeZone: TIMEZONE };
  if (patch.endLocal) body.end = { dateTime: patch.endLocal, timeZone: TIMEZONE };
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar respondió ${res.status} al actualizar.`);
  }
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
 * Lista los eventos de un calendario en un rango (paginado). Requiere que el
 * usuario autorice Google (mismo flujo que la creación de eventos).
 */
export async function listCalendarEvents(opts: {
  calendarId?: string | null;
  timeMinIso: string;
  timeMaxIso: string;
}): Promise<RawCalendarEvent[]> {
  const token = await getAccessToken();
  const calId = encodeURIComponent(opts.calendarId?.trim() || 'primary');
  const out: RawCalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: opts.timeMinIso,
      timeMax: opts.timeMaxIso,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar respondió ${res.status} al listar.`);
    }
    const data = (await res.json()) as {
      items?: RawCalendarEvent[];
      nextPageToken?: string;
    };
    for (const it of data.items ?? []) out.push(it);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
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
  const token = await getAccessToken();
  const calId = encodeURIComponent(calendarId?.trim() || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  // 410 = ya borrado; 404 = no existe. Ambos son aceptables.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google Calendar respondió ${res.status} al borrar.`);
  }
}
