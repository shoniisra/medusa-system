import { useCallback, useMemo } from 'react';
import {
  Calendar,
  dateFnsLocalizer,
  type View,
  type NavigateAction,
  type Event as RbcEvent,
} from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import TimeGrid from 'react-big-calendar/lib/TimeGrid';
import { format, parse, startOfWeek, startOfDay, addDays, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/cn';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './agenda-calendar.css';

const locales = { es };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop(Calendar);

/** Vistas propias además de las de react-big-calendar. */
export type AgendaView = View | 'three';

export interface AgendaEvent extends RbcEvent {
  id: string;
  start: Date;
  end: Date;
  title: string;
  /** Línea secundaria (servicio): se recorta antes que el nombre. */
  subtitle?: string;
  color: string;
}

const FALLBACK = '#64748b';

/* ───────────────────────── Vista de 3 días ─────────────────────────
   En un teléfono, 7 columnas dejan 45 px por día: ilegible. La app de
   Google resuelve lo mismo con una vista de 3 días, que es la que usamos
   como predeterminada en móvil. */

function ThreeDayView(props: { date: Date }) {
  const range = ThreeDayView.range(props.date);
  return (
    <TimeGrid
      {...props}
      range={range}
      eventOffset={12}
    />
  );
}
ThreeDayView.range = (date: Date): Date[] =>
  [0, 1, 2].map((i) => addDays(startOfDay(date), i));
ThreeDayView.navigate = (date: Date, action: NavigateAction): Date => {
  if (action === 'PREV') return addDays(date, -3);
  if (action === 'NEXT') return addDays(date, 3);
  return date;
};
ThreeDayView.title = (date: Date): string =>
  format(date, "d 'de' MMMM", { locale: es });

/**
 * Contenido del bloque de cita. El nombre siempre se lee entero (una línea con
 * puntos suspensivos); el servicio cede el espacio cuando la cita es corta.
 */
function EventChip({ event }: { event: object }) {
  const e = event as AgendaEvent;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <span className="truncate font-semibold leading-tight">{e.title}</span>
      {e.subtitle && (
        <span className="truncate text-[10px] leading-tight opacity-70">
          {e.subtitle}
        </span>
      )}
    </div>
  );
}

/** En la vista de mes cada celda es una línea: solo el nombre. */
function EventChipCompact({ event }: { event: object }) {
  return (
    <span className="block truncate font-semibold">
      {(event as AgendaEvent).title}
    </span>
  );
}

/** Encabezado de columna al estilo Google: día arriba, número grande abajo. */
function DayHeader({ date }: { date: Date }) {
  const today = startOfDay(new Date()).getTime() === startOfDay(date).getTime();
  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5">
      <span
        className={cn(
          'text-[11px] uppercase',
          today ? 'text-gold-300' : 'text-white/45',
        )}
      >
        {format(date, 'EEE', { locale: es })}
      </span>
      <span
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full text-[17px] font-medium',
          today ? 'bg-gold-400 text-ink-950' : 'text-white/85',
        )}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

export function AgendaCalendar({
  events,
  date,
  view,
  onNavigate,
  onView,
  onSelectEvent,
  onDrop,
  onSelectSlot,
  className,
  flush = false,
  toolbar = true,
}: {
  events: AgendaEvent[];
  date: Date;
  view: AgendaView;
  onNavigate: (d: Date) => void;
  onView: (v: AgendaView) => void;
  onSelectEvent: (id: string) => void;
  onDrop: (id: string, start: Date, end: Date) => void;
  onSelectSlot: (start: Date) => void;
  className?: string;
  /** Sin tarjeta ni bordes: el calendario ocupa todo el alto disponible. */
  flush?: boolean;
  toolbar?: boolean;
}) {
  type DropArgs = {
    event: object;
    start: string | Date;
    end: string | Date;
  };
  const handleDrop = useCallback(
    ({ event, start, end }: DropArgs) => {
      onDrop((event as AgendaEvent).id, new Date(start), new Date(end));
    },
    [onDrop],
  );

  const eventPropGetter = useCallback(
    (event: object) => ({
      style: {
        backgroundColor: (event as AgendaEvent).color || FALLBACK,
        color: '#0b0c12',
        fontWeight: 600,
      },
    }),
    [],
  );

  const messages = useMemo(
    () => ({
      today: 'Hoy',
      previous: '‹',
      next: '›',
      month: 'Mes',
      week: 'Semana',
      day: 'Día',
      agenda: 'Lista',
      date: 'Fecha',
      time: 'Hora',
      event: 'Cita',
      noEventsInRange: 'Sin citas en este rango.',
      showMore: (n: number) => `+${n} más`,
    }),
    [],
  );

  // El encabezado grande solo aplica a las vistas de tiempo; en "Mes" las
  // columnas son días de la semana y ese formato no tendría sentido.
  const components = useMemo(
    () =>
      view === 'month'
        ? { event: EventChipCompact }
        : { header: DayHeader, event: EventChip },
    [view],
  );

  const views = useMemo(
    () => ({ three: ThreeDayView, day: true, week: true, month: true }),
    [],
  );

  // Horas límite de la rejilla. Base: 7:00–21:00 (horario del salón más el
  // margen). Si alguna cita visible cae fuera (los días de desfile se agenda
  // desde las 3–5 am, a veces hasta tarde), el rango se abre lo justo para
  // que esos turnos no queden ocultos. La vista "Mes" no usa rejilla horaria,
  // así que mantiene los valores por defecto.
  const { minDate, maxDate, scrollDate } = useMemo(() => {
    const DEFAULT_MIN_H = 7;
    const DEFAULT_MAX_H = 21;
    const DEFAULT_SCROLL_H = 8;

    if (view === 'month') {
      return {
        minDate: new Date(1970, 0, 1, DEFAULT_MIN_H, 0),
        maxDate: new Date(1970, 0, 1, DEFAULT_MAX_H, 0),
        scrollDate: new Date(1970, 0, 1, DEFAULT_SCROLL_H, 0),
      };
    }

    let rangeStart: Date;
    let rangeEnd: Date;
    if (view === 'three') {
      rangeStart = startOfDay(date);
      rangeEnd = addDays(rangeStart, 3);
    } else if (view === 'day') {
      rangeStart = startOfDay(date);
      rangeEnd = addDays(rangeStart, 1);
    } else {
      // 'week'
      rangeStart = startOfWeek(date, { weekStartsOn: 1 });
      rangeEnd = addDays(rangeStart, 7);
    }

    let earliestMin = DEFAULT_MIN_H * 60;
    let latestMin = DEFAULT_MAX_H * 60;

    for (const e of events) {
      if (e.end <= rangeStart || e.start >= rangeEnd) continue;
      const sMin = e.start.getHours() * 60 + e.start.getMinutes();
      if (sMin < earliestMin) earliestMin = sMin;
      // Si cruza medianoche, topa en 24:00; si no, usa el fin real.
      const sameDay =
        e.start.toDateString() === e.end.toDateString();
      const eMin = sameDay
        ? e.end.getHours() * 60 + e.end.getMinutes()
        : 24 * 60;
      if (eMin > latestMin) latestMin = eMin;
    }

    const minHour = Math.floor(earliestMin / 60);
    // Subir el techo a la hora siguiente para que un fin a las 20:45 no quede
    // cortado. 24:00 no es válido en rbc: lo bajamos a 23:59.
    let maxTotal = Math.ceil(latestMin / 60) * 60;
    if (maxTotal >= 24 * 60) maxTotal = 24 * 60 - 1;

    const scrollHour = Math.min(DEFAULT_SCROLL_H, minHour);

    return {
      minDate: new Date(1970, 0, 1, minHour, 0),
      maxDate: new Date(
        1970,
        0,
        1,
        Math.floor(maxTotal / 60),
        maxTotal % 60,
      ),
      scrollDate: new Date(1970, 0, 1, scrollHour, 0),
    };
  }, [events, view, date]);

  const body = (
    <DnDCalendar
      localizer={localizer}
      culture="es"
      events={events}
      date={date}
      // `three` es una vista propia: el tipo público de rbc solo conoce las suyas.
      view={view as View}
      onNavigate={onNavigate}
      onView={(v) => onView(v)}
      views={views}
      components={components}
      toolbar={toolbar}
      step={30}
      timeslots={2}
      popup
      selectable
      resizable
      // En móvil, un roce al hacer scroll disparaba un drag o un "select slot"
      // y mandaba al alta de cita o reprogramaba por accidente. Con 500 ms
      // hay que mantener presionado: scroll normal queda intacto, drag queda
      // explícito. En escritorio el mouse no toca este umbral.
      longPressThreshold={500}
      min={minDate}
      max={maxDate}
      scrollToTime={scrollDate}
      dayLayoutAlgorithm="no-overlap"
      messages={messages}
      eventPropGetter={eventPropGetter}
      onSelectEvent={(e) => onSelectEvent((e as AgendaEvent).id)}
      onSelectSlot={(slot) => onSelectSlot(new Date(slot.start))}
      onEventDrop={handleDrop}
      onEventResize={handleDrop}
      style={{ height: '100%' }}
    />
  );

  if (flush) {
    return (
      <div className={cn('medusa-rbc medusa-rbc-flush min-h-0 flex-1', className)}>
        {body}
      </div>
    );
  }

  return (
    <div className={cn('medusa-rbc glass-card p-3', className)} style={{ height: 640 }}>
      {body}
    </div>
  );
}
