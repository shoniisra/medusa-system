/**
 * Normalización de teléfonos a un único formato canónico E.164 (`+<país><número>`).
 *
 * Objetivo: que un mismo contacto no quede guardado en cinco formatos distintos
 * (`09…`, `+593…`, con espacios/guiones) ni se duplique. Todo se guarda como
 * `+5939XXXXXXXX` y se compara siempre normalizado.
 */

export interface Country {
  /** Código ISO, usado como key. */
  iso: string;
  /** Código telefónico sin `+` (ej. "593"). */
  dial: string;
  name: string;
  flag: string;
}

/** Países soportados en el select. Ecuador primero (por defecto). */
export const COUNTRIES: Country[] = [
  { iso: 'EC', dial: '593', name: 'Ecuador', flag: '🇪🇨' },
  { iso: 'CO', dial: '57', name: 'Colombia', flag: '🇨🇴' },
  { iso: 'PE', dial: '51', name: 'Perú', flag: '🇵🇪' },
  { iso: 'VE', dial: '58', name: 'Venezuela', flag: '🇻🇪' },
  { iso: 'AR', dial: '54', name: 'Argentina', flag: '🇦🇷' },
  { iso: 'CL', dial: '56', name: 'Chile', flag: '🇨🇱' },
  { iso: 'MX', dial: '52', name: 'México', flag: '🇲🇽' },
  { iso: 'US', dial: '1', name: 'EEUU', flag: '🇺🇸' },
  { iso: 'ES', dial: '34', name: 'España', flag: '🇪🇸' },
];

/** País por defecto: Ecuador. */
export const DEFAULT_COUNTRY = COUNTRIES[0];

/** Dials ordenados de más largo a más corto (para matchear prefijos bien). */
const DIALS_BY_LEN = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** Quita todo lo que no sea dígito. */
const digitsOnly = (s: string): string => s.replace(/\D/g, '');

/**
 * Arma el formato canónico E.164 a partir de la parte local + código de país.
 * - `dial === ''` significa "internacional / otro país": la parte local ya trae
 *   el número completo con su código, así que solo se limpia y se le pone `+`.
 * - Saca espacios, guiones y paréntesis.
 * - Saca el `0` inicial de marcado nacional (ej. `099…` → `99…`).
 * Devuelve `''` si no hay número.
 */
export function normalizePhone(local: string, dial: string): string {
  // Si pegaron un número que ya empieza con `+`, ya es E.164: no lo tocamos.
  if (local.trim().startsWith('+')) {
    const d = digitsOnly(local);
    return d ? `+${d}` : '';
  }
  let d = digitsOnly(local);
  if (!dial) return d ? `+${d}` : ''; // internacional ya completo
  // Si pegaron el número completo con código de país, lo respetamos.
  if (d.startsWith(dial) && d.length > dial.length) {
    return `+${d}`;
  }
  d = d.replace(/^0+/, ''); // 0 de marcado nacional
  if (!d) return '';
  return `+${dial}${d}`;
}

/**
 * Separa un teléfono guardado en { dial, local }.
 * - Si empieza con `+` y el país está en la lista → lo separa.
 * - Si empieza con `+` pero el país NO está en la lista → { dial: '', local }
 *   (internacional): se preserva tal cual, nunca se le antepone otro código.
 * - Número nacional `09…` o dígitos sueltos → se asume Ecuador.
 */
export function parsePhone(stored: string | null | undefined): {
  dial: string;
  local: string;
} {
  if (!stored) return { dial: DEFAULT_COUNTRY.dial, local: '' };
  const d = digitsOnly(stored);
  if (stored.trim().startsWith('+')) {
    for (const c of DIALS_BY_LEN) {
      if (d.startsWith(c.dial)) return { dial: c.dial, local: d.slice(c.dial.length) };
    }
    // País desconocido: internacional, se conserva completo.
    return { dial: '', local: d };
  }
  // Legacy nacional ecuatoriano (09…) o dígitos sueltos.
  return { dial: DEFAULT_COUNTRY.dial, local: d.replace(/^0+/, '') };
}

/** Solo dígitos del canónico, para armar el link de wa.me. */
export function phoneToWaDigits(stored: string | null | undefined): string {
  return digitsOnly(normalizeStored(stored));
}

/**
 * Normaliza un teléfono ya guardado (posible legacy) al formato canónico.
 * Útil para comparar/deduplicar registros viejos.
 */
export function normalizeStored(stored: string | null | undefined): string {
  if (!stored) return '';
  const { dial, local } = parsePhone(stored);
  return normalizePhone(local, dial);
}
