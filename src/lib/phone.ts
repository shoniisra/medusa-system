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
function normalizeStored(stored: string | null | undefined): string {
  if (!stored) return '';
  const { dial, local } = parsePhone(stored);
  return normalizePhone(local, dial);
}

/* ────────────────────────────── Validación ────────────────────────────── */

interface PhoneRule {
  /** Largos válidos del número local (sin código de país). */
  lengths: number[];
  /** Cómo se describe el largo esperado en el mensaje de error. */
  hint: string;
  /** Chequeo fino cuando el país distingue celular de fijo por prefijo. */
  test?: (local: string) => boolean;
}

/**
 * Reglas de largo por país. Solo para los países del select: un número de
 * "🌐 Otro" se valida con el rango genérico de E.164 (8–15 dígitos).
 */
const PHONE_RULES: Record<string, PhoneRule> = {
  // Celular 9XXXXXXXX (9) · fijo con código de área 2–7 + 7 dígitos (8).
  593: {
    lengths: [8, 9],
    hint: '9 dígitos si es celular (empieza con 9) u 8 si es fijo',
    test: (l) =>
      (l.length === 9 && l.startsWith('9')) ||
      (l.length === 8 && /^[2-7]/.test(l)),
  },
  57: { lengths: [10], hint: '10 dígitos' },
  51: { lengths: [9], hint: '9 dígitos' },
  58: { lengths: [10], hint: '10 dígitos' },
  54: { lengths: [10, 11], hint: '10 dígitos (11 con el 9 de celular)' },
  56: { lengths: [9], hint: '9 dígitos' },
  52: { lengths: [10], hint: '10 dígitos' },
  1: { lengths: [10], hint: '10 dígitos' },
  34: { lengths: [9], hint: '9 dígitos' },
};

/**
 * Valida un teléfono canónico. Devuelve el mensaje de error, o `null` si está
 * bien. Vacío se considera válido: el teléfono es opcional y quien lo necesite
 * obligatorio lo chequea aparte.
 */
export function validatePhone(canonical: string | null | undefined): string | null {
  const v = (canonical ?? '').trim();
  if (!v) return null;
  const { dial, local } = parsePhone(v);
  if (!dial) {
    // País fuera de la lista: solo se exige un largo razonable de E.164.
    return local.length >= 8 && local.length <= 15
      ? null
      : 'Número internacional inválido (entre 8 y 15 dígitos).';
  }
  const rule = PHONE_RULES[dial];
  if (!rule) return null;
  const ok = rule.test
    ? rule.test(local)
    : rule.lengths.includes(local.length);
  if (ok) return null;
  const country = COUNTRIES.find((c) => c.dial === dial);
  return `El número de ${country?.name ?? 'ese país'} debe tener ${rule.hint}. Escribiste ${local.length}.`;
}
