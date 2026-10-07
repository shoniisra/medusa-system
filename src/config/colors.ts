/**
 * Paleta de colores de Google Calendar.
 *
 * Son las 24 opciones que ofrece Google al pintar un calendario, con el nombre
 * que muestra en español. El color del equipo sale de acá y de ningún otro
 * lado: así lo que se ve en la agenda del sistema es lo mismo que se ve en
 * Google Calendar, sin hex inventados a mano.
 *
 * Ojo: al crear un evento Google solo acepta los 11 colores de evento (los que
 * acá tienen `eventId`). Un color sin `eventId` es válido para identificar al
 * colaborador, pero el evento sincronizado se pinta con el color de evento más
 * parecido (ver `hexToGoogleColorId` en lib/googleCalendar).
 */
export interface CalendarColor {
  /** Nombre tal cual lo muestra Google Calendar en español. */
  name: string;
  hex: string;
  /** colorId de evento de Google (1..11) cuando este color es uno de ellos. */
  eventId?: string;
}

/** Orden igual al del selector de Google Calendar (rojo → morado → neutros). */
const CALENDAR_COLORS: CalendarColor[] = [
  { name: 'Vino', hex: '#AD1457' },
  { name: 'Rosa', hex: '#D81B60' },
  { name: 'Flamenco', hex: '#E67C73', eventId: '4' },
  { name: 'Tomate', hex: '#D50000', eventId: '11' },
  { name: 'Mandarina', hex: '#F4511E', eventId: '6' },
  { name: 'Calabaza', hex: '#EF6C00' },
  { name: 'Mango', hex: '#F09300' },
  { name: 'Girasol', hex: '#F6BF26', eventId: '5' },
  { name: 'Mostaza', hex: '#E4C441' },
  { name: 'Aguacate', hex: '#C0CA33' },
  { name: 'Pistacho', hex: '#7CB342' },
  { name: 'Albahaca', hex: '#0B8043', eventId: '10' },
  { name: 'Menta', hex: '#33B679', eventId: '2' },
  { name: 'Eucalipto', hex: '#009688' },
  { name: 'Turquesa', hex: '#039BE5', eventId: '7' },
  { name: 'Cobalto', hex: '#4285F4' },
  { name: 'Lavanda', hex: '#7986CB', eventId: '1' },
  { name: 'Índigo', hex: '#3F51B5', eventId: '9' },
  { name: 'Malva', hex: '#B39DDB' },
  { name: 'Amatista', hex: '#9E69AF' },
  { name: 'Uva', hex: '#8E24AA', eventId: '3' },
  { name: 'Chocolate', hex: '#795548' },
  { name: 'Grafito', hex: '#616161', eventId: '8' },
  { name: 'Abedul', hex: '#A79B8E' },
];

/** Color por defecto de un colaborador nuevo. */
export const DEFAULT_CALENDAR_COLOR = CALENDAR_COLORS[14]; // Turquesa

/**
 * Los 11 colores de evento de Google: los únicos que la API reporta.
 *
 * La UI de Google Calendar ofrece 24 al pintar un evento, pero `colorId` solo
 * existe para estos once. Un evento pintado con cualquiera de los otros 13
 * (Calabaza, Mango, Eucalipto…) llega a la sincronización sin color, igual que
 * uno sin pintar. Por eso el color identificador de una colaboradora tiene que
 * salir de acá: los demás son ciegos para cualquier integración.
 */
export const GOOGLE_EVENT_COLORS = CALENDAR_COLORS.filter(
  (c): c is CalendarColor & { eventId: string } => !!c.eventId,
);

const norm = (hex: string): string => hex.trim().toLowerCase();

/** Busca un color de la paleta por hex (sin importar mayúsculas). */
export function findCalendarColor(
  hex: string | null | undefined,
): CalendarColor | null {
  if (!hex) return null;
  return CALENDAR_COLORS.find((c) => norm(c.hex) === norm(hex)) ?? null;
}

/** Nombre del color para mostrar; si no es de la paleta, devuelve el hex. */
export function calendarColorName(hex: string | null | undefined): string {
  if (!hex) return '—';
  return findCalendarColor(hex)?.name ?? hex.toUpperCase();
}
