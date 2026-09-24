import { useCallback, useMemo } from 'react';
import {
  Calendar,
  dateFnsLocalizer,
  type View,
  type Event as RbcEvent,
} from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
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

export interface AgendaEvent extends RbcEvent {
  id: string;
  start: Date;
  end: Date;
  title: string;
  color: string;
}

const FALLBACK = '#64748b';

export function AgendaCalendar({
  events,
  date,
  view,
  onNavigate,
  onView,
  onSelectEvent,
  onDrop,
  onSelectSlot,
}: {
  events: AgendaEvent[];
  date: Date;
  view: View;
  onNavigate: (d: Date) => void;
  onView: (v: View) => void;
  onSelectEvent: (id: string) => void;
  onDrop: (id: string, start: Date, end: Date) => void;
  onSelectSlot: (start: Date) => void;
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

  return (
    <div className="medusa-rbc glass-card p-3" style={{ height: 640 }}>
      <DnDCalendar
        localizer={localizer}
        culture="es"
        events={events}
        date={date}
        view={view}
        onNavigate={onNavigate}
        onView={onView}
        views={['month', 'week', 'day', 'agenda']}
        step={30}
        timeslots={2}
        popup
        selectable
        resizable
        min={new Date(1970, 0, 1, 7, 0)}
        max={new Date(1970, 0, 1, 21, 0)}
        messages={messages}
        eventPropGetter={eventPropGetter}
        onSelectEvent={(e) => onSelectEvent((e as AgendaEvent).id)}
        onSelectSlot={(slot) => onSelectSlot(new Date(slot.start))}
        onEventDrop={handleDrop}
        onEventResize={handleDrop}
        style={{ height: '100%' }}
      />
    </div>
  );
}
