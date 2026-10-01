import { CURRENCY, LOCALE } from '@/config/constants';

const currencyFmt = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const money = (n: number | null | undefined): string =>
  currencyFmt.format(n ?? 0);

export const num = (n: number | null | undefined): string =>
  numberFmt.format(n ?? 0);

export const percent = (n: number | null | undefined): string =>
  `${num(n ?? 0)}%`;

/** ISO → "23 sep 2026". */
export const dateShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  // Una fecha solo-día ("YYYY-MM-DD") se interpreta como local, no como UTC
  // (new Date("2026-09-25") sería UTC medianoche y retrocedería 1 día en UTC−5).
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`)
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/** ISO → "14:30". */
export const timeShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // 24 h: en una lista de citas en móvil, "10:00–11:00" se lee de un vistazo;
  // "10:00 a. m.–11:00 a. m." ocupa el doble y se corta.
  return d.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

/**
 * "YYYY-MM-DD" del día actual en la zona local.
 *
 * Vive en `lib/date` (se calculaba con `toISOString()`, que es UTC: en UTC−5,
 * pasadas las 19:00 devolvía el día siguiente). Se reexporta porque medio
 * sistema ya lo importa desde acá.
 */
export { todayISO } from './date';

/** Nombre completo a partir de first/last. */
export const fullName = (
  first: string,
  last?: string | null,
): string => (last ? `${first} ${last}` : first);

/** Date → "YYYY-MM-DDTHH:mm:ss" en hora local (naive, sin zona). */
export const toLocalNaive = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** id corto tipo uuid v4 (para tempIds del POS). */
export const genId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
