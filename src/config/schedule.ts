/**
 * Horario comercial y utilidades de disponibilidad.
 *
 * Realidad del salón:
 *  - Lun–Vie 10:00–18:00, Sáb 09:00–16:00, Dom cerrado.
 *  - A veces hay horas extra → reservar fuera de horario se PERMITE pero se avisa.
 *  - La duración depende del servicio (uñas 20–30 min, color 4–5 h).
 *  - El solape con otra cita del mismo estilista se BLOQUEA.
 *
 * Nota: el "algunas colaboradoras salen más temprano" no está en el esquema
 * (haría falta una tabla de turnos por colaborador). Por ahora se modela el
 * horario del local; el early-leave queda como mejora futura.
 */

export interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

/** Índice 0=Dom … 6=Sáb. null = cerrado. */
export const BUSINESS_HOURS: (DayHours | null)[] = [
  null, // Dom
  { open: '10:00', close: '18:00' }, // Lun
  { open: '10:00', close: '18:00' }, // Mar
  { open: '10:00', close: '18:00' }, // Mié
  { open: '10:00', close: '18:00' }, // Jue
  { open: '10:00', close: '18:00' }, // Vie
  { open: '09:00', close: '16:00' }, // Sáb
];

/** Duración por defecto (min) si el servicio no la define. */
export const DEFAULT_SERVICE_MINUTES = 30;

/** Intervalo libre mínimo a mostrar en disponibilidad (min). */
export const MIN_FREE_MINUTES = 20;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Horario del día para una fecha "YYYY-MM-DD". */
export const hoursForDate = (dateISO: string): DayHours | null => {
  const wd = new Date(`${dateISO}T00:00:00`).getDay();
  return BUSINESS_HOURS[wd];
};

export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * Intervalos libres de un estilista en un día, dado su horario y sus citas.
 * `nowMin` recorta el pasado cuando la fecha es hoy (null = no recortar).
 */
export function freeIntervals(
  hours: DayHours | null,
  booked: Interval[],
  nowMin: number | null,
): Interval[] {
  if (!hours) return [];
  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  let cursor = nowMin != null ? Math.max(openMin, nowMin) : openMin;

  const sorted = [...booked].sort((a, b) => a.startMin - b.startMin);
  const free: Interval[] = [];

  for (const b of sorted) {
    if (b.startMin > cursor) {
      free.push({ startMin: cursor, endMin: Math.min(b.startMin, closeMin) });
    }
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= closeMin) break;
  }
  if (cursor < closeMin) free.push({ startMin: cursor, endMin: closeMin });

  return free.filter((i) => i.endMin - i.startMin >= MIN_FREE_MINUTES);
}

/** ¿[s,e) se solapa con algún intervalo ocupado? */
export function overlaps(booked: Interval[], s: number, e: number): boolean {
  return booked.some((b) => s < b.endMin && e > b.startMin);
}

export type SlotCheck =
  | { ok: true; overtime: boolean }
  | { ok: false; reason: string };

/**
 * Valida una reserva: dentro del día abierto, sin solape (bloquea) y marca
 * si cae fuera de horario (hora extra → permite con aviso).
 */
export function validateSlot(
  dateISO: string,
  startMin: number,
  durationMin: number,
  booked: Interval[],
): SlotCheck {
  const hours = hoursForDate(dateISO);
  if (!hours) return { ok: false, reason: 'El local está cerrado ese día.' };
  const endMin = startMin + durationMin;
  if (overlaps(booked, startMin, endMin)) {
    return { ok: false, reason: 'El estilista ya tiene una cita en ese horario.' };
  }
  const openMin = toMinutes(hours.open);
  const closeMin = toMinutes(hours.close);
  const overtime = startMin < openMin || endMin > closeMin;
  return { ok: true, overtime };
}
