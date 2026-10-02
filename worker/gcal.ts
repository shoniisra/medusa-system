/**
 * Puente sistema → Google Calendar usando una **service account**.
 *
 * Antes esto vivía en el navegador con Google Identity Services: cada usuaria
 * tenía que iniciar sesión con su cuenta de Google y chocaba con la pantalla de
 * "app en modo de prueba" (el scope de Calendar es sensible y la app no está
 * verificada). El calendario es del salón, no de cada usuaria, así que no hay
 * razón para autenticar por persona: acá una sola identidad de servidor escribe
 * en los calendarios y el único login de la app queda siendo Cloudflare Access.
 *
 * Flujo: se firma un JWT RS256 con la clave privada de la service account, se
 * cambia por un access token en oauth2.googleapis.com/token (cacheado ~55 min) y
 * con ese token se pega a la API de Calendar.
 *
 * Requisitos:
 *  1. Secrets del Worker: GCAL_SA_EMAIL (client_email) y GCAL_SA_PRIVATE_KEY
 *     (private_key del JSON, PEM completo). En dev van en .env sin prefijo
 *     VITE_, así que no entran al bundle del navegador.
 *  2. Cada calendario de sucursal compartido con GCAL_SA_EMAIL con permiso
 *     "Hacer cambios en los eventos", y su ID en branch.google_calendar_id.
 *
 * Este módulo usa solo APIs web (fetch, crypto.subtle, atob/btoa), así que corre
 * igual en el Worker y en el middleware de dev de Vite.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars';
const DEFAULT_TIMEZONE = 'America/Guayaquil';
/** Tope de páginas al listar: cortafuegos contra un bucle infinito. */
const MAX_PAGES = 20;

export interface GcalEnv {
  GCAL_SA_EMAIL?: string;
  GCAL_SA_PRIVATE_KEY?: string;
}

export interface GcalResult {
  status: number;
  body: unknown;
}

/** Error con el status HTTP que le corresponde en la respuesta. */
class GcalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ───────────────────────────── JWT / token ───────────────────────────── */

function b64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64urlText = (text: string): string =>
  b64url(new TextEncoder().encode(text));

/**
 * PEM PKCS#8 → ArrayBuffer. Tolera la clave guardada en una sola línea con los
 * saltos escapados (`\n`), que es como queda si el secret se copia del JSON.
 */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new GcalError('GCAL_SA_PRIVATE_KEY está vacía.', 503);
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: string | null = null;
let cachedExpiry = 0;
/** Email de la service account con la que se emitió el token cacheado. */
let cachedFor = '';

function serviceAccountEmail(env: GcalEnv): string | null {
  const email = env.GCAL_SA_EMAIL?.trim();
  return email ? email : null;
}

function isGcalConfigured(env: GcalEnv): boolean {
  return !!serviceAccountEmail(env) && !!env.GCAL_SA_PRIVATE_KEY?.trim();
}

async function getAccessToken(env: GcalEnv): Promise<string> {
  const email = serviceAccountEmail(env);
  const pem = env.GCAL_SA_PRIVATE_KEY;
  if (!email || !pem?.trim()) {
    throw new GcalError(
      'La service account de Google no está configurada en el servidor ' +
        '(faltan los secrets GCAL_SA_EMAIL / GCAL_SA_PRIVATE_KEY).',
      503,
    );
  }
  if (cachedToken && cachedFor === email && Date.now() < cachedExpiry) {
    return cachedToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new GcalError(
      `Google rechazó la service account: ${
        data.error_description ?? data.error ?? `HTTP ${res.status}`
      }`,
      502,
    );
  }

  cachedToken = data.access_token;
  cachedFor = email;
  // 5 min de margen sobre el vencimiento real (normalmente 3600 s).
  cachedExpiry = Date.now() + ((data.expires_in ?? 3600) - 300) * 1000;
  return cachedToken;
}

/* ──────────────────────────── API de Calendar ─────────────────────────── */

/**
 * La service account no tiene calendario "primary": el destino SIEMPRE es el
 * calendario de la sucursal, y si falta hay que decirlo claro.
 */
function requireCalendarId(raw: unknown, env: GcalEnv): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) {
    throw new GcalError(
      'La sucursal no tiene calendario de Google configurado ' +
        '(branch.google_calendar_id). Compartí el calendario del salón con ' +
        `${serviceAccountEmail(env) ?? 'la service account'} con permiso ` +
        '"Hacer cambios en los eventos" y guardá su ID en la sucursal.',
      400,
    );
  }
  if (id.toLowerCase() === 'primary') {
    throw new GcalError(
      'La service account no tiene calendario "primary": hay que guardar el ID ' +
        'del calendario del salón en la sucursal.',
      400,
    );
  }
  return id;
}

/** Llama a la API de Calendar y traduce los errores de Google a algo legible. */
async function calendarFetch(
  env: GcalEnv,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const token = await getAccessToken(env);
  const res = await fetch(`${CAL_API}/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401) {
    // El token quedó inválido (clave rotada): que el próximo intento reemita.
    cachedToken = null;
    cachedExpiry = 0;
  }
  return res;
}

async function googleError(res: Response, env: GcalEnv): Promise<GcalError> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  const detail = data.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 403 || res.status === 404) {
    return new GcalError(
      `Google respondió "${detail}". Revisá que el calendario esté compartido ` +
        `con ${serviceAccountEmail(env) ?? 'la service account'} con permiso ` +
        '"Hacer cambios en los eventos" y que el ID de la sucursal sea correcto.',
      502,
    );
  }
  return new GcalError(`Google Calendar respondió: ${detail}`, 502);
}

const asText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

interface EventTime {
  dateTime: string;
  timeZone: string;
}

function eventTime(local: unknown, timeZone: string): EventTime | undefined {
  const value = asText(local);
  return value ? { dateTime: value, timeZone } : undefined;
}

/* ──────────────────────────── Acciones ────────────────────────────────── */

interface Payload {
  action?: string;
  calendarId?: unknown;
  eventId?: unknown;
  timeZone?: unknown;
  summary?: unknown;
  description?: unknown;
  colorId?: unknown;
  startLocal?: unknown;
  endLocal?: unknown;
  timeMinIso?: unknown;
  timeMaxIso?: unknown;
}

/**
 * Punto único de entrada de POST /api/gcal. Devuelve status + cuerpo JSON; el
 * transporte (Worker o middleware de Vite) solo lo envuelve en una Response.
 *
 * Nunca se mandan `attendees` ni invitaciones: los eventos son la agenda interna
 * del salón, no citas con invitados (de ahí `sendUpdates=none`).
 */
export async function handleGcal(
  raw: unknown,
  env: GcalEnv,
): Promise<GcalResult> {
  try {
    const p = (raw ?? {}) as Payload;
    const timeZone = asText(p.timeZone) ?? DEFAULT_TIMEZONE;

    // Diagnóstico: ¿está configurado el servidor y se llega al calendario?
    if (p.action === 'status') {
      const email = serviceAccountEmail(env);
      if (!isGcalConfigured(env)) {
        return {
          status: 200,
          body: {
            configured: false,
            serviceAccount: email,
            error:
              'Faltan los secrets GCAL_SA_EMAIL / GCAL_SA_PRIVATE_KEY en el servidor.',
          },
        };
      }
      const wanted = asText(p.calendarId);
      if (!wanted) {
        return { status: 200, body: { configured: true, serviceAccount: email } };
      }
      const calId = requireCalendarId(wanted, env);
      // Se prueba listando un evento, NO leyendo el calendario: el metadato de
      // /calendars/{id} pide un scope más amplio que calendar.events.
      const params = new URLSearchParams({
        maxResults: '1',
        timeMin: new Date().toISOString(),
      });
      const res = await calendarFetch(
        env,
        `${encodeURIComponent(calId)}/events?${params.toString()}`,
      );
      if (!res.ok) throw await googleError(res, env);
      return {
        status: 200,
        body: { configured: true, serviceAccount: email, calendarId: calId },
      };
    }

    if (p.action === 'create') {
      const calId = requireCalendarId(p.calendarId, env);
      const start = eventTime(p.startLocal, timeZone);
      const end = eventTime(p.endLocal, timeZone);
      if (!start || !end) {
        throw new GcalError('Faltan startLocal / endLocal para crear el evento.');
      }
      // id propuesto por el cliente: deriva del id de la cita, así crear el
      // evento es idempotente (un reintento no deja dos eventos) y la cita ya
      // puede guardarse con su google_calendar_event_id ANTES de llamar acá.
      // Google exige base32hex (a-v y 0-9) de 5 a 1024 caracteres.
      const wantedId = asText(p.eventId);
      if (wantedId && !/^[a-v0-9]{5,1024}$/.test(wantedId)) {
        throw new GcalError('eventId inválido para Google Calendar.');
      }
      const res = await calendarFetch(
        env,
        `${encodeURIComponent(calId)}/events?sendUpdates=none`,
        {
          method: 'POST',
          body: {
            id: wantedId ?? undefined,
            summary: asText(p.summary) ?? 'Cita',
            description: asText(p.description),
            start,
            end,
            colorId: asText(p.colorId),
          },
        },
      );
      // 409: ese id ya existe → el evento ya se había creado (reintento, doble
      // click, respuesta perdida). Es el resultado buscado, no un error.
      if (res.status === 409 && wantedId) {
        return { status: 200, body: { id: wantedId, existed: true } };
      }
      if (!res.ok) throw await googleError(res, env);
      const data = (await res.json()) as { id: string };
      return { status: 200, body: { id: data.id } };
    }

    if (p.action === 'patch') {
      const calId = requireCalendarId(p.calendarId, env);
      const eventId = asText(p.eventId);
      if (!eventId) throw new GcalError('Falta eventId para actualizar.');
      const body: Record<string, unknown> = {};
      if (asText(p.summary)) body.summary = p.summary;
      if (asText(p.description)) body.description = p.description;
      if (asText(p.colorId)) body.colorId = p.colorId;
      const start = eventTime(p.startLocal, timeZone);
      const end = eventTime(p.endLocal, timeZone);
      if (start) body.start = start;
      if (end) body.end = end;
      if (Object.keys(body).length === 0) {
        return { status: 200, body: { ok: true, skipped: true } };
      }
      const res = await calendarFetch(
        env,
        `${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
        { method: 'PATCH', body },
      );
      // 404/410: el evento ya no está en Google. La cita local manda.
      if (res.status === 404 || res.status === 410) {
        return { status: 200, body: { ok: true, missing: true } };
      }
      if (!res.ok) throw await googleError(res, env);
      return { status: 200, body: { ok: true } };
    }

    if (p.action === 'delete') {
      const calId = requireCalendarId(p.calendarId, env);
      const eventId = asText(p.eventId);
      if (!eventId) throw new GcalError('Falta eventId para borrar.');
      const res = await calendarFetch(
        env,
        `${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
        { method: 'DELETE' },
      );
      if (res.status === 404 || res.status === 410) {
        return { status: 200, body: { ok: true, missing: true } };
      }
      if (!res.ok) throw await googleError(res, env);
      return { status: 200, body: { ok: true } };
    }

    if (p.action === 'list') {
      const calId = requireCalendarId(p.calendarId, env);
      const timeMin = asText(p.timeMinIso);
      const timeMax = asText(p.timeMaxIso);
      if (!timeMin || !timeMax) {
        throw new GcalError('Faltan timeMinIso / timeMaxIso para listar.');
      }
      const items: unknown[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '2500',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await calendarFetch(
          env,
          `${encodeURIComponent(calId)}/events?${params.toString()}`,
        );
        if (!res.ok) throw await googleError(res, env);
        const data = (await res.json()) as {
          items?: unknown[];
          nextPageToken?: string;
        };
        for (const it of data.items ?? []) items.push(it);
        pageToken = data.nextPageToken;
        pages += 1;
      } while (pageToken && pages < MAX_PAGES);
      return { status: 200, body: { items } };
    }

    throw new GcalError(`Acción de Google Calendar desconocida: ${p.action}`);
  } catch (e) {
    if (e instanceof GcalError) return { status: e.status, body: { error: e.message } };
    return {
      status: 500,
      body: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}
