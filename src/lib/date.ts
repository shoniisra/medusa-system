/**
 * Utilidades de fecha solo-día ("YYYY-MM-DD", el formato que guarda la base).
 *
 * Todo se calcula en hora local: `new Date('2026-09-25')` sería medianoche UTC
 * y en UTC−5 retrocede un día, así que nunca se usa el constructor con el ISO
 * pelado ni `toISOString()` para obtener "hoy".
 */

/** Date → "YYYY-MM-DD" en hora local. */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" de hoy (local). */
export const todayISO = (): string => ymd(new Date());

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es un "YYYY-MM-DD" que existe en el calendario? */
function isValidISODate(iso: string): boolean {
  const m = ISO_RE.exec(iso);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(mo) - 1 &&
    date.getDate() === Number(d)
  );
}

/** "YYYY-MM-DD" → Date local a medianoche (null si no es válida). */
export function fromISO(iso: string | null | undefined): Date | null {
  if (!iso || !isValidISODate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** ISO → "dd/mm/aaaa" (vacío si no hay fecha). */
export function toDMY(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = ISO_RE.exec(iso);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/**
 * Interpreta lo que la usuaria escribió. Acepta día/mes/año con cualquier
 * separador (`15/3/1990`, `15-3-90`, `15.03.1990`), los 8 dígitos seguidos
 * (`15031990`), y el ISO pegado desde otro lado (`1990-03-15`).
 *
 * Con año de dos cifras: `90` → 1990, `05` → 2005 (todo lo que pase del año
 * actual se lee como del siglo pasado, que es el caso de los cumpleaños).
 */
export function parseLooseDate(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // ISO tal cual.
  if (ISO_RE.test(raw)) return isValidISODate(raw) ? raw : null;

  const digits = raw.replace(/\D/g, '');
  let d: number, mo: number, y: number;

  const parts = raw.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    // El año va de dos o de cuatro cifras: a medio escribir ("15/03/1") no hay
    // fecha todavía, y adivinarla sería mostrar 2001 por un instante.
    if (parts[2].length !== 2 && parts[2].length !== 4) return null;
    [d, mo, y] = parts.map(Number);
  } else if (digits.length === 8) {
    d = Number(digits.slice(0, 2));
    mo = Number(digits.slice(2, 4));
    y = Number(digits.slice(4));
  } else if (digits.length === 6) {
    d = Number(digits.slice(0, 2));
    mo = Number(digits.slice(2, 4));
    y = Number(digits.slice(4));
  } else {
    return null;
  }

  if (y < 100) {
    const cc = new Date().getFullYear() % 100;
    y = y > cc ? 1900 + y : 2000 + y;
  }
  if (y < 1000) return null;

  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(
    d,
  ).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

/**
 * Da forma a lo que se va escribiendo, sin pelearse con quien escribe.
 *
 * Los dígitos van llenando día, mes y año (2-2-4) y la barra aparece sola al
 * empezar el siguiente campo —no antes, así se puede borrar hacia atrás sin
 * que el campo la reponga—. Si la usuaria escribe la barra, cierra el campo
 * donde está y completa el cero: `7/3/93` → `07/03/93`.
 */
export function maskDMY(input: string): string {
  const segs = [''];
  for (const ch of input) {
    const i = segs.length - 1;
    if (/\d/.test(ch)) {
      const limit = i === 2 ? 4 : 2;
      if (segs[i].length < limit) segs[i] += ch;
      else if (segs.length < 3) segs.push(ch);
      // Con día, mes y año completos ya no entra nada más.
    } else {
      if (segs.length === 3 || segs[i] === '') continue;
      segs[i] = segs[i].padStart(2, '0');
      segs.push('');
    }
  }
  return segs.join('/');
}

export const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const MONTHS_ES_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Iniciales de lunes a domingo (la semana del salón arranca el lunes). */
export const WEEKDAYS_ES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;

/**
 * Celdas del mes para la cuadrícula del calendario: siempre 6 semanas × 7 días
 * (así el panel no cambia de alto al pasar de mes) con los días de los meses
 * vecinos incluidos.
 */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay(): 0 = domingo. La cuadrícula empieza en lunes.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Suma (o resta) meses conservando el día cuando existe. */
export function addMonths(year: number, month: number, delta: number): {
  year: number;
  month: number;
} {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * Días hasta el próximo cumpleaños, contados desde hoy (0 = hoy, 1 = mañana).
 * null si la fecha no sirve. El 29 de febrero, en años no bisiestos, lo celebra
 * el 1 de marzo (lo normaliza el propio `Date`).
 */
export function daysUntilBirthday(
  iso: string | null | undefined,
  from: Date = new Date(),
): number | null {
  const birth = fromISO(iso ?? '');
  if (!birth) return null;
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** Cuenta regresiva en palabras: "¡Hoy!", "Mañana" o "en N días". */
export function birthdayCountdown(days: number): string {
  if (days <= 0) return '¡Hoy!';
  if (days === 1) return 'Mañana';
  return `en ${days} días`;
}

/** "4 oct" a partir del cumpleaños (día y mes, sin año). Vacío si no sirve. */
export function birthdayDayMonth(iso: string | null | undefined): string {
  const d = fromISO(iso ?? '');
  if (!d) return '';
  return `${d.getDate()} ${MONTHS_ES_SHORT[d.getMonth()]}`;
}

/** Edad cumplida a partir del cumpleaños (null si la fecha no sirve). */
export function ageFrom(iso: string | null | undefined): number | null {
  const d = fromISO(iso ?? '');
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const before =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (before) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
