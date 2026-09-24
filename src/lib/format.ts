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
  const d = new Date(iso);
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
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
};

/** "YYYY-MM-DD" del día actual en la zona local. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

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
