import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Pencil,
  Trash2,
  List,
  Columns3,
} from 'lucide-react';
import type { View } from 'react-big-calendar';
import { query, execute, batch } from '@/lib/db';
import { timeShort, dateShort, toLocalNaive } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { APPOINTMENT_STATUS, ROUTES } from '@/config/constants';
import {
  isGoogleCalendarEnabled,
  deleteCalendarEvent,
  updateCalendarEvent,
} from '@/lib/googleCalendar';
import { Card, Badge, Button, Modal, EmptyState } from '@/components/ui';
import { GoogleCalendarEmbed } from './GoogleCalendarEmbed';
import { AgendaCalendar, type AgendaEvent } from './AgendaCalendar';
import { cn } from '@/lib/cn';
import type { AppointmentStatus } from '@/types';

interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer_name: string | null;
  phone: string | null;
  staff_id: string | null;
  staff_name: string | null;
  staff_color: string | null;
  service_name: string | null;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
}

type RangeMode = 'today' | 'week' | 'month';
type ViewMode = 'list' | 'kanban' | 'calendar';

const FALLBACK_COLOR = '#64748b';
const STATUS_ORDER: AppointmentStatus[] = [
  'reserved',
  'confirmed',
  'attended',
  'cancelled',
  'no_show',
];

/* ─────────────────────────── Rango de fechas ─────────────────────────── */

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeFor(mode: RangeMode): { from: string; to: string; label: string } {
  const now = new Date();
  if (mode === 'today') {
    const t = ymd(now);
    return { from: t, to: t, label: dateShort(t) };
  }
  if (mode === 'week') {
    const diffToMon = (now.getDay() + 6) % 7; // 0=lunes
    const mon = new Date(now);
    mon.setDate(now.getDate() - diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      from: ymd(mon),
      to: ymd(sun),
      label: `${dateShort(ymd(mon))} — ${dateShort(ymd(sun))}`,
    };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: ymd(first),
    to: ymd(last),
    label: now.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }),
  };
}

/** Ventana amplia (mes ± 1 semana) alrededor de una fecha, para la vista calendario. */
function windowFor(d: Date): { from: string; to: string; label: string } {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  from.setDate(from.getDate() - 7);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  to.setDate(to.getDate() + 7);
  return {
    from: ymd(from),
    to: ymd(to),
    label: d.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }),
  };
}

/* ─────────────────────────────── Página ─────────────────────────────── */

export function CalendarPage() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeMode>('today');
  const [view, setView] = useState<ViewMode>('list');
  const [source, setSource] = useState<'internal' | 'google'>('internal');
  const [toDelete, setToDelete] = useState<AppointmentRow | null>(null);
  const [calDate, setCalDate] = useState(new Date());
  const [calView, setCalView] = useState<View>('week');

  const openAppt = (a: AppointmentRow) =>
    navigate(`${ROUTES.appointment}/${a.id}`);

  const { from, to, label } = useMemo(
    () => (view === 'calendar' ? windowFor(calDate) : rangeFor(range)),
    [view, range, calDate],
  );

  const appts = useQuery({
    queryKey: ['appointments', branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<AppointmentRow>(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.notes,
                a.google_calendar_id, a.google_calendar_event_id,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                c.phone,
                s.id AS staff_id,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                s.color AS staff_color,
                sv.name AS service_name
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
           LEFT JOIN appointment_item ai
                  ON ai.id = (SELECT ai2.id FROM appointment_item ai2
                               WHERE ai2.appointment_id = a.id LIMIT 1)
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN service sv ON sv.id = ai.service_id
          WHERE a.branch_id = ? AND date(a.start_at) BETWEEN ? AND ?
          ORDER BY a.start_at ASC`,
        [branchId, from, to],
      ),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['appointments'] });

  const events: AgendaEvent[] = useMemo(
    () =>
      (appts.data ?? []).map((a) => ({
        id: a.id,
        title: `${a.customer_name ?? 'Sin cliente'}${
          a.service_name ? ' · ' + a.service_name : ''
        }`,
        start: new Date(a.start_at),
        end: new Date(a.end_at),
        color: a.staff_color || FALLBACK_COLOR,
      })),
    [appts.data],
  );

  // Arrastrar/redimensionar en el calendario reprograma la cita (y su evento).
  const reschedule = useMutation({
    mutationFn: async ({
      id,
      start,
      end,
    }: {
      id: string;
      start: Date;
      end: Date;
    }) => {
      const row = appts.data?.find((a) => a.id === id);
      const startLocal = toLocalNaive(start);
      const endLocal = toLocalNaive(end);
      await execute(
        'UPDATE appointment SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?',
        [startLocal, endLocal, new Date().toISOString(), id],
      );
      if (row?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await updateCalendarEvent(
            row.google_calendar_event_id,
            row.google_calendar_id,
            { startLocal, endLocal },
          );
        } catch {
          /* la reprogramación local ya quedó guardada */
        }
      }
    },
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: async (a: AppointmentRow) => {
      // Borrar evento de Google (best-effort) si existe.
      if (a.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await deleteCalendarEvent(
            a.google_calendar_event_id,
            a.google_calendar_id,
          );
        } catch {
          /* si falla, igual borramos el registro local */
        }
      }
      await batch([
        { sql: 'DELETE FROM appointment_item WHERE appointment_id = ?', args: [a.id] },
        { sql: 'DELETE FROM appointment WHERE id = ?', args: [a.id] },
      ]);
    },
    onSuccess: () => {
      setToDelete(null);
      invalidate();
    },
  });

  const showInternal = source === 'internal';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Agenda</h1>
        <Button onClick={() => navigate(ROUTES.appointmentNew)}>
          <CalendarPlus className="h-4 w-4" /> Nueva cita
        </Button>
      </div>

      {/* Fuente: agenda propia vs Google Calendar */}
      <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
        <ToggleBtn
          active={source === 'internal'}
          onClick={() => setSource('internal')}
        >
          Agenda del sistema
        </ToggleBtn>
        <ToggleBtn
          active={source === 'google'}
          onClick={() => setSource('google')}
        >
          Google Calendar
        </ToggleBtn>
      </div>

      {source === 'google' && <GoogleCalendarEmbed />}

      {showInternal && (
        <>
          {/* Rango + vista */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {view === 'calendar' ? (
              <span />
            ) : (
              <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
                <ToggleBtn
                  active={range === 'today'}
                  onClick={() => setRange('today')}
                >
                  Hoy
                </ToggleBtn>
                <ToggleBtn
                  active={range === 'week'}
                  onClick={() => setRange('week')}
                >
                  Esta semana
                </ToggleBtn>
                <ToggleBtn
                  active={range === 'month'}
                  onClick={() => setRange('month')}
                >
                  Este mes
                </ToggleBtn>
              </div>
            )}
            <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
              <ToggleBtn active={view === 'list'} onClick={() => setView('list')}>
                <List className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={view === 'kanban'}
                onClick={() => setView('kanban')}
              >
                <Columns3 className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={view === 'calendar'}
                onClick={() => setView('calendar')}
              >
                <CalendarRange className="h-4 w-4" />
              </ToggleBtn>
            </div>
          </div>

          {view === 'calendar' ? (
            <AgendaCalendar
              events={events}
              date={calDate}
              view={calView}
              onNavigate={setCalDate}
              onView={setCalView}
              onSelectEvent={(id) =>
                navigate(`${ROUTES.appointment}/${id}`)
              }
              onDrop={(id, start, end) => {
                const row = appts.data?.find((a) => a.id === id);
                const staffId = row?.staff_id;
                const conflict = staffId
                  ? (appts.data ?? []).find(
                      (a) =>
                        a.id !== id &&
                        a.staff_id === staffId &&
                        new Date(a.start_at) < end &&
                        start < new Date(a.end_at),
                    )
                  : undefined;
                if (
                  conflict &&
                  !window.confirm(
                    `Se solapa con otra cita de ${
                      row?.staff_name ?? 'la estilista'
                    } (${
                      conflict.customer_name ?? 'sin cliente'
                    }). ¿Reprogramar de todas formas?`,
                  )
                ) {
                  return;
                }
                reschedule.mutate({ id, start, end });
              }}
              onSelectSlot={(start) =>
                navigate(`${ROUTES.appointmentNew}?date=${ymd(start)}`)
              }
            />
          ) : (
            <>
              <p className="text-center text-sm capitalize text-white/60">
                {label}
              </p>

              {!appts.data || appts.data.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={CalendarDays}
                    title="Sin citas en este período"
                    description="No hay reservas para el rango seleccionado."
                  />
                </Card>
              ) : view === 'list' ? (
                <ListView
                  rows={appts.data}
                  showDate={range !== 'today'}
                  onEdit={openAppt}
                  onDelete={setToDelete}
                />
              ) : (
                <KanbanView
                  rows={appts.data}
                  onEdit={openAppt}
                  onDelete={setToDelete}
                />
              )}
            </>
          )}
        </>
      )}

      {/* Confirmación de eliminado */}
      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Eliminar cita"
      >
        <p className="text-sm text-white/70">
          ¿Seguro que querés eliminar esta cita
          {toDelete?.customer_name ? ` de ${toDelete.customer_name}` : ''}? Esta
          acción no se puede deshacer.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setToDelete(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={del.isPending}
            onClick={() => toDelete && del.mutate(toDelete)}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ─────────────────────────────── Vistas ─────────────────────────────── */

function ListView({
  rows,
  showDate,
  onEdit,
  onDelete,
}: {
  rows: AppointmentRow[];
  showDate: boolean;
  onEdit: (a: AppointmentRow) => void;
  onDelete: (a: AppointmentRow) => void;
}) {
  return (
    <Card>
      <ul className="divide-y divide-white/5">
        {rows.map((a) => {
          const meta = APPOINTMENT_STATUS[a.status];
          const color = a.staff_color || FALLBACK_COLOR;
          return (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="kpi-gold text-sm">
                    {showDate ? `${dateShort(a.start_at.slice(0, 10))} · ` : ''}
                    {timeShort(a.start_at)}–{timeShort(a.end_at)}
                  </p>
                </div>
                <p className="truncate text-sm font-medium text-white">
                  {a.customer_name ?? 'Sin cliente'}
                </p>
                <p className="truncate text-xs text-white/40">
                  {a.service_name ?? 'Servicio'}
                  {a.staff_name ? ` · ${a.staff_name}` : ''}
                </p>
              </div>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <RowActions a={a} onEdit={onEdit} onDelete={onDelete} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function KanbanView({
  rows,
  onEdit,
  onDelete,
}: {
  rows: AppointmentRow[];
  onEdit: (a: AppointmentRow) => void;
  onDelete: (a: AppointmentRow) => void;
}) {
  const byStatus = useMemo(() => {
    const m: Record<AppointmentStatus, AppointmentRow[]> = {
      reserved: [],
      confirmed: [],
      attended: [],
      cancelled: [],
      no_show: [],
    };
    for (const a of rows) m[a.status].push(a);
    return m;
  }, [rows]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((status) => {
        const meta = APPOINTMENT_STATUS[status];
        const items = byStatus[status];
        return (
          <div key={status} className="w-64 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-xs text-white/40">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/30">
                  Vacío
                </div>
              ) : (
                items.map((a) => {
                  const color = a.staff_color || FALLBACK_COLOR;
                  return (
                    <div
                      key={a.id}
                      className="rounded-xl border border-white/10 bg-ink-800/60 p-3"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <p className="kpi-gold text-xs">
                        {dateShort(a.start_at.slice(0, 10))} · {timeShort(a.start_at)}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium text-white">
                        {a.customer_name ?? 'Sin cliente'}
                      </p>
                      <p className="truncate text-xs text-white/40">
                        {a.service_name ?? 'Servicio'}
                        {a.staff_name ? ` · ${a.staff_name}` : ''}
                      </p>
                      <div className="mt-2 flex justify-end">
                        <RowActions a={a} onEdit={onEdit} onDelete={onDelete} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowActions({
  a,
  onEdit,
  onDelete,
}: {
  a: AppointmentRow;
  onEdit: (a: AppointmentRow) => void;
  onDelete: (a: AppointmentRow) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        title="Editar"
        onClick={() => onEdit(a)}
        className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        title="Eliminar"
        onClick={() => onDelete(a)}
        className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-gold-400 text-ink-950'
          : 'text-white/60 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
